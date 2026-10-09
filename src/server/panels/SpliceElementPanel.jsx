import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection, currentProject } from '../../core/storage'
import { computeAutoC } from '../../core/utils/rules/cant'
import {
  buildSplice, clearanceRequest, neighbourAxis, secondPickRefusal, settleLengths, spliceFromAnswer, splicePick, spliceRequest,
} from '../../core/utils/commands/splice'
import { gaugeProfile } from '../../core/utils/gaugeProfiles'
import { utmToWgs84 } from '../../core/utils/coordinateUtils'
import { trackLabel } from '../../core/utils/trackModel'
import { spliceOnServer } from '../optimizerService'
import { ZOOM_LINE_WIDTH } from '../../core/map/style'
import { TRACKS_HOVER_LAYER } from '../../core/map/layerIds'
import usePreview from '../../core/map/usePreview'
import useMapPick from '../../core/map/useMapPick'
import useDerivedField from '../../core/hooks/useDerivedField'
import { useI18n } from '../../core/locales/i18nContext'
import { PALETTE } from '../../core/styles/palette'
import CommitBar from '../../core/components/form/CommitBar'
import SpliceFindings from './splice/SpliceFindings'
import { severityRank } from '../../core/utils/regelkatalog'
import SpliceSettings from './splice/SpliceSettings'
import CancelButton from '../../core/components/form/CancelButton'
import { spacingMessage } from './splice/spacingMessage'
import ShiftValuesSection from '../../core/components/panels/shift/ShiftValuesSection'
import { comparedLine } from '../../core/utils/shiftValues'

const SPLICE_PREVIEW_SOURCE = 'splice-preview-source'
// The tightest place to the track the splice keeps its distance to: a line
// across from the new geometry to that track's axis.
const SPLICE_CLEARANCE_SOURCE = 'splice-clearance-source'
const SPLICE_PREVIEW_LAYERS = [{
  sourceId: SPLICE_PREVIEW_SOURCE,
  layer: {
    id: 'splice-preview-layer', type: 'line',
    paint: { 'line-color': PALETTE.mapHover, 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] },
  },
}, {
  sourceId: SPLICE_CLEARANCE_SOURCE,
  layer: {
    id: 'splice-clearance-layer', type: 'line',
    paint: { 'line-color': ['get', 'colour'], 'line-width': 2 },
  },
}]

/** How long the settings must rest before the service is asked [ms]. */
const SPLICE_DEBOUNCE = 150

const line = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
})

const DEFAULTS = {
  // The speed is the faster pick's once both are picked (Entscheidung 181).
  radius: 500, speed: '',
  // The transition beside each pick, in the order they were clicked: switched
  // on or not — one side alone is fine — and its shape ('clothoid' | 'bloss').
  transitionOn: [false, false], transitionTypes: ['clothoid', 'clothoid'],
  // The shape of a single transition from arc to arc.
  transitionType: 'clothoid',
  // Two arcs can be joined either by a straight between them or by a single
  // transition curve straight from one to the other (AP 4.1).
  arcJoin: 'straight',                                  // 'straight' | 'transition'
  // The transition beside each pick, in the order they were clicked: switched
  // on, the Regellänge the service names is set once ('regular', Entscheidung
  // 185), from then on the length here as it is ('fixed').
  transitions: [60, 60], modes: ['regular', 'regular'],
  // Keeping a spacing to another track (Entscheidung 167): checked at the
  // radius given, or the largest radius that keeps it searched.
  clearanceOn: false, clearanceDMin: 4.0, clearanceMax: false,
}

/**
 * A splice that does not fit, as a sentence: the error, and what would fit
 * (AP S.5) — the largest radius below the one asked for, the smallest above
 * it, the longest transitions.
 */
function errorText(t, fill, error, params = {}) {
  // The keys are the service's (splice.py); one this bundle does not know yet reads as no fit.
  const known = error.startsWith('splice_error_') || error === 'splice_service_unavailable'
  const text = t(known ? error : 'splice_error_no_fit')
  const hints = [
    params.rMax != null && fill('splice_r_max', { r: String(params.rMax) }),
    params.rMin != null && fill('splice_r_min', { r: String(params.rMin) }),
    params.lMax != null && fill('splice_l_max', { l: String(params.lMax).replace('.', ',') }),
  ].filter(Boolean)
  // The error texts end with or without a full stop; each hint is a sentence of its own.
  return hints.length ? `${text}${/[.!?]$/.test(text) ? '' : '.'} ${hints.join(' ')}` : text
}

/** What the dialog says about a splice: its error, or the solution shown. */
function spliceMessage(t, fill, splice, solution) {
  if (splice.error) return { msg: errorText(t, fill, splice.error, splice.params), error: true }
  const { result, dep, arr } = solution
  // Departure first, as the solution runs.
  const side = (k) => result.lengths[k]?.length ?? 0
  const [Ld, La] = [side(result.depPick), side(1 - result.depPick)]
  const tr = (Ld > 0 || La > 0) ? ` | ${t('transition_curve')}: ${Ld.toFixed(1)}+${La.toFixed(1)} m` : ''
  // Two arcs, or an arc and a straight: re-shaped elements and a solved
  // construction rather than an arc rounding a corner.
  const arcMode = dep.signedR != null || arr.signedR != null
  if (result.transitionLength != null) {
    return { msg: `${t(result.compound ? 'splice_compound' : 'splice_reverse')}: ${t('transition_curve')} ~${result.transitionLength.toFixed(1)} m`, error: false }
  }
  if (result.straightLength != null) {
    return { msg: `${t('splice_arrival')} ↔ ${t('splice_departure')}: ~${result.straightLength.toFixed(1)} m${tr}`, error: false }
  }
  const len = `${t('splice_arc_length')}: ~${result.arcLength.toFixed(1)} m${tr}`
  return { msg: arcMode ? len : `${len} | ${t(result.signedR < 0 ? 'splice_left' : 'splice_right')}`, error: false }
}

/** How a dialog names the neighbour: its name, else its line and track number. */
const trackName = (track) => (track ? track.name || trackLabel(track) : '')

/** Which solution is chosen: by the ends it joins and, for two arcs, how. */
const solutionKey = (sol) => `${sol.result.ends.join()}|${sol.result.arcJoin ?? ''}`

/**
 * Choosing among several solutions (Entscheidung 180): the one shown, which
 * ends it joins, how two arcs are joined, how much it rebuilds — stepping to
 * the next, and where the one shown joins two arcs the other way than asked
 * for, taking that way over (`onAdopt`).
 */
function SolutionSwitch({ solutions, solution, picks, onChoose, onAdopt }) {
  const { t, fill, num } = useI18n()
  const i = Math.max(0, solutions.indexOf(solution))
  const { ends, rebuilt, arcJoin, alternative } = solution.result
  const end = (k) => fill(ends[k] === 'end' ? 'splice_at_end' : 'splice_at_start', { track: picks[k].label })
  const several = solutions.length > 1
  return (
    <div className="splice-solutions">
      {several && (
        <button type="button" className="panel-btn" aria-label={t('splice_solution_prev')}
          onClick={() => onChoose(solutions[(i + solutions.length - 1) % solutions.length])}>◀</button>
      )}
      <span>
        {fill('splice_solution', { i: String(i + 1), n: String(solutions.length) })}: {end(0)} ↔ {end(1)}
        {arcJoin && ` · ${t(`splice_arc_join_${arcJoin}`)}`}
        {' · '}{fill('splice_rebuilt', { l: num(rebuilt, { digits: 0, unit: 'm' }) })}
      </span>
      {several && (
        <button type="button" className="panel-btn" aria-label={t('splice_solution_next')}
          onClick={() => onChoose(solutions[(i + 1) % solutions.length])}>▶</button>
      )}
      {alternative && arcJoin && (
        <button type="button" className="panel-btn secondary" onClick={() => onAdopt(solution)}>{t('splice_adopt')}</button>
      )}
    </div>
  )
}

/**
 * Splice two tracks into one (R5.5, AP 12.4: the construction is the service's,
 * the commit in utils/commands/splice). Two elements are picked, in either
 * order; the service finds which ends meet and which one departs (AP S.2)
 * and joins them by an arc, re-shaped arcs or a transition — where several
 * ways fit, the best is shown and the others can be stepped through. The
 * merged track is one commit. Every change of the settings asks the service
 * again, once they rest; without the service there is no splice.
 */
export default function SpliceElementPanel() {
  const { t, fill } = useI18n()
  const [picks, setPicks] = useState([])   // the two picks, in the order they were clicked
  // The solution chosen among several, by the ends it joins (null: the best).
  const [chosen, setChosen] = useState(null)
  const [s, setS] = useState(DEFAULTS)
  const set = (key, value) => setS(prev => ({ ...prev, [key]: value }))
  // The radius is a magnitude here, so the cant is one too. It follows speed
  // and radius unless the user overrode it for that pair.
  const [pickStatus, setPickStatus] = useState(null)   // { msg, error }
  const configuring = picks.length === 2
  const bothArcs = configuring && picks[0].signedR != null && picks[1].signedR != null
  // The track the splice keeps its distance to, and whether it is being picked.
  const [refTrackId, setRefTrackId] = useState(null)
  const [pickingRef, setPickingRef] = useState(false)
  const keeping = configuring && s.clearanceOn && refTrackId != null
  // Two arcs have no radius of their own to choose: their spacing is only checked.
  const maximize = keeping && s.clearanceMax && !bothArcs

  // The answer the service gave last — with the search, the radius it found
  // stands in for the one typed, and the cant follows it.
  const [answer, setAnswer] = useState(null)   // { key, splice }
  const answered = answer?.splice?.solutions ?? null
  const shown = answered?.find(sol => solutionKey(sol) === chosen) ?? answered?.[0] ?? null
  const found = maximize ? shown?.result?.clearance?.radius ?? null : null
  const radius = found ?? s.radius
  const [typedCant, setCant] = useDerivedField(`${s.speed}|${radius}`, Math.abs(computeAutoC(s.speed, Math.abs(Number(radius)))))
  // With the search, the cant is the one the service solved the radius found
  // with — its transitions and findings are that cant's (AP S.6).
  const searchedCant = maximize ? shown?.result?.clearance?.cant ?? null : null
  const cant = searchedCant ?? typedCant

  const preview = usePreview(SPLICE_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  useMapPick({
    active: configuring && pickingRef, hover: 'track',
    onPick: ({ trackId }) => { setRefTrackId(trackId); setPickingRef(false) },
  })

  useMapPick({
    active: !configuring, hover: 'element',
    onPick: ({ trackId, elementIndex }) => {
      const pick = splicePick(loadTracks().find(tr => tr.id === trackId), elementIndex)
      if (!pick) return
      if (pick.error) { setPickStatus({ msg: t(pick.error), error: true }); return }
      if (picks.length === 1) {
        const why = secondPickRefusal(picks[0], pick)
        if (why === 'same') return
        if (why) { setPickStatus({ msg: t(why), error: true }); return }
      }
      // Which one departs is the service's to find, not the order of the clicks.
      setPicks(picks.length === 1 ? [picks[0], pick] : [pick])
      // The faster of the two, the rules judging the stricter case (Entscheidung 181).
      if (picks.length === 1) set('speed', Math.max(picks[0].speed ?? 0, pick.speed ?? 0) || '')
      setChosen(null)
      setPickStatus(null)
    },
  })

  // The neighbour's axis near the two picks, read once per track picked.
  const refTrack = keeping ? loadTracks().find(tr => tr.id === refTrackId) ?? null : null
  const axis = useMemo(
    () => (refTrack ? neighbourAxis(refTrack, picks[0].epsg, picks[0], picks[1]) : null),
    // the track and the picks are what the axis is read from
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refTrackId, picks])

  // The preview and the commit read the same answer, so they cannot disagree.
  // An answer counts only for the request it was given to. The key names the
  // neighbour instead of carrying its axis; with the search, neither the
  // radius typed nor the cant takes part — the service chooses both.
  const clearance = keeping && axis ? clearanceRequest({
    axis: null, dMin: s.clearanceDMin, profile: gaugeProfile(currentProject()?.gaugeProfile).points,
    maximize, speed: s.speed, cant: maximize ? 0 : cant,
  }) : null
  const requestKey = configuring
    ? JSON.stringify({
      ...spliceRequest(picks[0], picks[1], maximize ? { ...s, radius: 0, cant: 0 } : { ...s, cant }, clearance),
      neighbour: clearance ? refTrackId : undefined,
    })
    : null
  useEffect(() => {
    if (!requestKey) return undefined
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const { neighbour: _n, ...req } = JSON.parse(requestKey)
        if (req.clearance) req.clearance.ref = axis
        const a = await spliceOnServer(req, { signal: ctl.signal })
        const read = spliceFromAnswer(a, picks)
        setAnswer({ key: requestKey, splice: read })
        // Transitions just switched on take the Regellänge named, once.
        const sol = read.solutions?.find(x => solutionKey(x) === chosen) ?? read.solutions?.[0]
        setS(prev => settleLengths(prev, sol?.result?.lengths ?? read.lengths))
      } catch (err) {
        if (err?.name !== 'AbortError') setAnswer({ key: requestKey, splice: { error: 'splice_service_unavailable' } })
      }
    }, SPLICE_DEBOUNCE)
    return () => { clearTimeout(timer); ctl.abort() }
    // picks and settings are what the key is made of, the axis follows the neighbour named in it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])
  const splice = answer?.key === requestKey ? answer.splice : null
  const solutions = splice?.solutions ?? null
  const solution = solutions ? shown : null
  const spacing = keeping ? solution?.result?.clearance ?? null : null

  useEffect(() => {
    preview.set(SPLICE_PREVIEW_SOURCE, solution ? line(solution.result.previewCoords) : null)
    const epsg = picks[0]?.epsg
    preview.set(SPLICE_CLEARANCE_SOURCE, spacing?.at && spacing?.ref && epsg ? {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { colour: spacing.kept ? PALETTE.valid : PALETTE.invalid },
        geometry: { type: 'LineString', coordinates: [utmToWgs84(...spacing.at, epsg), utmToWgs84(...spacing.ref, epsg)] },
      }],
    } : null)
  }, [solution, spacing, picks, preview])

  // The track the splice would write, and the stretch of it that is new or
  // re-shaped — what its shift values against a reference axis are read over
  // (Paket V), its gradient with it.
  const merged = useMemo(() => {
    if (!solution) return null
    const built = buildSplice({ tracks: loadTracks(), solution, speed: s.speed, cant, newId: () => 'preview' })
    if (!built) return null
    const track = built.addTracks[0]
    const { first, last, from } = built.stretch
    return {
      track,
      line: comparedLine(track.elements.slice(first, last + 1), track.epsg, { heights: track.heights, station0: from }),
    }
  }, [solution, s.speed, cant])

  // The transition beside each pick, by pick, as the service set it in the
  // chain it solved: its mode, its length and the rules on it (AP S.3) — and
  // where nothing fits, the rules' lengths all the same.
  const transitionRules = s.transitionOn.some(Boolean) ? solution?.result?.lengths ?? splice?.lengths ?? null : null

  const reset = () => {
    preview.clear(); setPicks([]); setChosen(null); setPickStatus(null); setRefTrackId(null); setPickingRef(false)
  }

  // Two arcs joined the other way than asked for: that way taken over as the
  // setting — over a straight with the transitions the solution has.
  const adopt = (sol) => {
    const { arcJoin, lengths } = sol.result
    setChosen(`${sol.result.ends.join()}|${arcJoin}`)
    set('arcJoin', arcJoin)
    if (arcJoin === 'straight') {
      const on = lengths.map(l => l.length > 0)
      set('transitionOn', on)
      if (on.some(Boolean)) {
        set('modes', ['fixed', 'fixed'])
        set('transitions', lengths.map(l => l.length || DEFAULTS.transitions[0]))
      }
    }
  }

  const handleCommit = () => {
    const commit = buildSplice({ tracks: loadTracks(), solution, speed: s.speed, cant })
    if (!commit) return
    commitSwitchConnection(commit)
    reset()
  }

  if (configuring) {
    const departure = solution?.dep ?? picks[0]
    // What the service found on the stretch the solution writes: any error
    // there holds the commit back (Entscheidung 52, 177).
    const ruleError = (solution?.result?.findings ?? []).some(f => severityRank(f.severity) >= severityRank('error'))
    const status = splice ? spliceMessage(t, fill, splice, solution) : { msg: t('splice_solving'), error: false }
    const refName = refTrackId ? trackName(loadTracks().find(tr => tr.id === refTrackId)) : null
    const spacingMsg = keeping && solution ? spacingMessage(t, fill, spacing, refName) : null
    // Asked for, a spacing not kept — or not yet known — holds the commit back.
    const spacingHolds = !s.clearanceOn || (keeping && spacing?.kept === true)
    return (
      <>
        <h2>{t('splice_element')}</h2>
        <SpliceSettings picks={picks} departure={departure} s={s} set={set} cant={cant} setCant={setCant}
          transitionLength={solution?.result?.transitionLength} transitionRules={transitionRules}
          clearance={{ refName, pickingRef, onPickRef: () => setPickingRef(p => !p), maximize, found }} />
        {solution && (solutions.length > 1 || solution.result.alternative) && (
          <SolutionSwitch solutions={solutions} solution={solution} picks={picks}
            onChoose={sol => setChosen(solutionKey(sol))} onAdopt={adopt} />
        )}
        {splice?.requested && (
          <p className="msg-hint">
            {fill('splice_requested_failed', { join: t(`splice_arc_join_${s.arcJoin}`) })}{' '}
            {errorText(t, fill, splice.requested.error, splice.requested.params)}
          </p>
        )}
        {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
        {spacingMsg && <p className={spacingMsg.error ? 'msg-error' : 'msg-info'}>{spacingMsg.msg}</p>}
        {solution && <SpliceFindings result={solution.result} />}
        {merged && (
          <ShiftValuesSection id="shift-splice" line={merged.line} epsg={merged.track.epsg} heightEpsg={merged.track.heightEpsg}
            heightNote={!merged.track.heights?.length ? t('shift_no_heights_track') : null} name={merged.track.name ?? ''} />
        )}
        <CommitBar onCommit={handleCommit} onCancel={reset} disabled={!solution || !spacingHolds || ruleError}
          reason={solution && ruleError ? t('splice_rule_error') : null} />
      </>
    )
  }

  return (
    <>
      <h2>{t('splice_element')}</h2>
      <p>{picks.length === 0 ? t('splice_hint_first') : t('splice_hint_second')}</p>
      {picks.length > 0 && <p className="msg-info">{t('splice_first_selected')}: {picks[0].label}</p>}
      {pickStatus && <p className={pickStatus.error ? 'msg-error' : 'msg-hint'}>{pickStatus.msg}</p>}
      {picks.length === 1 && (
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={reset} />
      )}
    </>
  )
}
