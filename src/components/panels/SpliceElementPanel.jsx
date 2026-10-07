import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection, currentProject } from '../../storage'
import { computeAutoC } from '../../utils/rules/cant'
import { hasRuleError } from '../../utils/trassierungCheck'
import {
  buildSplice, clearanceRequest, neighbourAxis, secondPickRefusal, spliceFromAnswer, splicePick, spliceRequest,
  splicedTransitions,
} from '../../utils/commands/splice'
import { errorAt } from '../../utils/rules/transitionLength'
import { gaugeProfile } from '../../utils/gaugeProfiles'
import { utmToWgs84 } from '../../utils/coordinateUtils'
import { trackLabel } from '../../utils/trackModel'
import { spliceOnServer } from '../../utils/optimizerService'
import { ZOOM_LINE_WIDTH } from '../../map/style'
import { TRACKS_HOVER_LAYER } from '../../map/layerIds'
import usePreview from '../../map/usePreview'
import useMapPick from '../../map/useMapPick'
import useDerivedField from '../../hooks/useDerivedField'
import { useI18n } from '../../locales/i18nContext'
import { PALETTE } from '../../styles/palette'
import CommitBar from '../form/CommitBar'
import RuleFindings from './RuleFindings'
import SpliceSettings from './splice/SpliceSettings'
import CancelButton from '../form/CancelButton'

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
  clothoidEnabled: false, transitionType: 'clothoid',   // 'clothoid' | 'bloss'
  // Two arcs can be joined either by a straight between them or by a single
  // transition curve straight from one to the other (AP 4.1).
  arcJoin: 'straight',                                  // 'straight' | 'transition'
  // The transition beside each pick, in the order they were clicked: the
  // Regellänge unless switched (Entscheidung 179), the service solving it
  // from the length here on — or with 'fixed' this length as it is.
  transitions: [60, 60], modes: ['regular', 'regular'],
  // Keeping a spacing to another track (Entscheidung 167): checked at the
  // radius given, or the largest radius that keeps it searched.
  clearanceOn: false, clearanceDMin: 4.0, clearanceMax: false,
}

/** What the dialog says about a splice: its error, or the solution shown. */
function spliceMessage(t, fill, splice, solution) {
  if (splice.error) {
    const rMax = splice.params?.rMax
    // The keys are the service's (splice.py); one this bundle does not know yet reads as no fit.
    const known = splice.error.startsWith('splice_error_') || splice.error === 'splice_service_unavailable'
    const text = t(known ? splice.error : 'splice_error_no_fit')
    // The error texts end with or without a full stop; the hint is a sentence of its own.
    const hint = rMax != null ? `${/[.!?]$/.test(text) ? '' : '.'} ${fill('splice_r_max', { r: String(rMax) })}` : ''
    return { msg: text + hint, error: true }
  }
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

/**
 * What the dialog says about the spacing to the neighbour: the tightest place
 * with the spacing it has and the one asked for there (the minimum and what
 * the cant adds), with the search the radius it found.
 */
function spacingMessage(t, fill, c, refName) {
  if (!c) return null
  const found = c.maximized ? fill('splice_clearance_found', { r: String(c.radius), u: String(Math.round(c.cant)) }) + ' ' : ''
  if (!c.near) return { msg: found + fill('splice_clearance_far', { track: refName }), error: false }
  const mm = (u) => String(Math.round(Math.abs(u)))
  const text = fill(c.kept ? 'splice_clearance_kept' : 'splice_clearance_short', {
    track: refName, d: c.distance.toFixed(2), req: c.required.toFixed(2),
    add: (c.required - c.dMin).toFixed(2), u1: mm(c.cantNew), u2: mm(c.cantRef),
  })
  return { msg: found + text, error: !c.kept }
}

/**
 * Choosing among several solutions (Entscheidung 180): the one shown, which
 * ends it joins, how much it rebuilds — and stepping to the next.
 */
function SolutionSwitch({ solutions, solution, picks, onChoose }) {
  const { t, fill, num } = useI18n()
  const i = Math.max(0, solutions.indexOf(solution))
  const { ends, rebuilt } = solution.result
  const end = (k) => fill(ends[k] === 'end' ? 'splice_at_end' : 'splice_at_start', { track: picks[k].label })
  return (
    <div className="splice-solutions">
      <button type="button" className="panel-btn" aria-label={t('splice_solution_prev')}
        onClick={() => onChoose(solutions[(i + solutions.length - 1) % solutions.length])}>◀</button>
      <span>
        {fill('splice_solution', { i: String(i + 1), n: String(solutions.length) })}: {end(0)} ↔ {end(1)}
        {' · '}{fill('splice_rebuilt', { l: num(rebuilt, { digits: 0, unit: 'm' }) })}
      </span>
      <button type="button" className="panel-btn" aria-label={t('splice_solution_next')}
        onClick={() => onChoose(solutions[(i + 1) % solutions.length])}>▶</button>
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
  const shown = answered?.find(sol => sol.result.ends.join() === chosen) ?? answered?.[0] ?? null
  const found = maximize ? shown?.result?.clearance?.radius ?? null : null
  const radius = found ?? s.radius
  const [cant, setCant] = useDerivedField(`${s.speed}|${radius}`, Math.abs(computeAutoC(s.speed, Math.abs(Number(radius)))))

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
        setAnswer({ key: requestKey, splice: spliceFromAnswer(a, picks) })
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

  // The transitions the splice inserts, checked in the track it would write.
  const spliced = configuring && solution
    ? splicedTransitions({ tracks: loadTracks(), solution, speed: s.speed, cant })
    : null
  // The transition beside each pick, by pick, as the service set it in the
  // chain it solved: its mode, its length and the rules on it (AP S.3).
  const transitionRules = s.clothoidEnabled ? solution?.result?.lengths ?? null : null

  const reset = () => {
    preview.clear(); setPicks([]); setChosen(null); setPickStatus(null); setRefTrackId(null); setPickingRef(false)
  }

  const handleCommit = () => {
    const commit = buildSplice({ tracks: loadTracks(), solution, speed: s.speed, cant })
    if (!commit) return
    commitSwitchConnection(commit)
    reset()
  }

  if (configuring) {
    const departure = solution?.dep ?? picks[0]
    // Only the inserted arc takes a cant; an arc+arc splice re-shapes the two
    // existing arcs, which keep theirs — and inserts no element of its own, so
    // there is nothing for the catalogue to judge in that case. The length
    // judged is the one the construction solved, not one that was typed.
    const inserted = !bothArcs && solution?.result?.arcLength != null
      ? { elementType: 1, radius: Number(radius), cant, speed: s.speed, length: solution.result.arcLength }
      : null
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
        {solutions?.length > 1 && (
          <SolutionSwitch solutions={solutions} solution={solution} picks={picks}
            onChoose={sol => setChosen(sol.result.ends.join())} />
        )}
        {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
        {spacingMsg && <p className={spacingMsg.error ? 'msg-error' : 'msg-info'}>{spacingMsg.msg}</p>}
        {inserted && <RuleFindings element={inserted} />}
        {spliced?.transitions.length > 0 && (
          <RuleFindings elements={spliced.elements} judge={spliced.transitions} fields={false} />
        )}
        <CommitBar onCommit={handleCommit} onCancel={reset}
          disabled={!solution || !spacingHolds || (inserted ? hasRuleError([inserted]) : false)
            || (spliced?.transitions.length > 0 && errorAt(spliced.elements, spliced.transitions))} />
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
