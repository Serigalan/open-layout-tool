import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection, currentProject } from '../../../storage'
import { computeAutoC, severityRank } from '../../../utils/rules'
import {
  buildSplice, clearanceRequest, neighbourAxis, secondPickRefusal, settleLengths, spliceFromAnswer,
  spliceKeptCant, splicePick, spliceRequest,
} from '../../../utils/commands'
import { gaugeProfile } from '../../../utils/crossSection'
import { utmToWgs84 } from '../../../utils/geometry'
import { trackLabel } from '../../../utils/track'
import { solveSpliceInWorker, hasJumpError, spliceRemedies } from '../../../utils/splice'
import { provided } from '../../../extensions'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import useDerivedField from '../../../hooks/useDerivedField'
import { useI18n } from '../../../locales/i18nContext'
import { PALETTE } from '../../../styles/palette'
import CommitBar from '../../form/CommitBar'
import SpliceFindings from './SpliceFindings'
import SpliceSettings from './SpliceSettings'
import ClearanceFields from './ClearanceFields'
import SolutionSwitch from './SolutionSwitch'
import SpliceRemedies from './SpliceRemedies'
import { SPLICE_DEFAULTS, adoptedSettings, solutionKey, spliceErrorText, spliceMessage } from './spliceText'
import CancelButton from '../../form/CancelButton'
import { spacingMessage } from './spacingMessage'
import ShiftValuesSection from '../shift/ShiftValuesSection'
import { comparedLine } from '../../../utils/survey'

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

/** How long the settings must rest before the splice is computed again [ms]. */
const SPLICE_DEBOUNCE = 150

const line = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
})

// The settings, and the spacing to another track (Entscheidung 167): checked
// at the radius given, or the largest radius that keeps it searched.
const DEFAULTS = { ...SPLICE_DEFAULTS, clearanceOn: false, clearanceDMin: 4.0, clearanceMax: false }

/** How a dialog names the neighbour: its name, else its line and track number. */
const trackName = (track) => (track ? track.name || trackLabel(track) : '')

/**
 * Splice two tracks into one (R5.5; the construction in utils/splice, computed
 * in the browser for both builds since decision 294 — before that on the
 * optimizer service —, the commit in utils/commands/splice). Two elements are
 * picked, in either order; the splice finds which ends meet and which one
 * departs (AP S.2) and joins them by an arc, re-shaped arcs or a transition —
 * where several ways fit, the best is shown and the others can be stepped
 * through. The merged track is one commit. Every change of the settings
 * computes the splice again in a worker, once they rest — held to a spacing
 * to another track, which only the server offers, on the optimizer service.
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
  // The spacing to another track is the optimizer service's (decision 295):
  // where the server provides it, a splice held to one is asked there as a
  // whole; without it (the local build) there is no spacing to keep.
  const withClearance = provided('spliceWithClearance', null)
  // The track the splice keeps its distance to, and whether it is being picked.
  const [refTrackId, setRefTrackId] = useState(null)
  const [pickingRef, setPickingRef] = useState(false)
  const keeping = !!withClearance && configuring && s.clearanceOn && refTrackId != null
  // Two arcs have no radius of their own to choose: their spacing is only checked.
  const maximize = keeping && s.clearanceMax && !bothArcs

  // The answer given last — with the search, the radius it found
  // stands in for the one typed, and the cant follows it.
  const [answer, setAnswer] = useState(null)   // { key, splice }
  const answered = answer?.splice?.solutions ?? null
  const shown = answered?.find(sol => solutionKey(sol) === chosen) ?? answered?.[0] ?? null
  const found = maximize ? shown?.result?.clearance?.radius ?? null : null
  const radius = found ?? s.radius
  // The cant is free. Proposed where a side has no transition is the pick's
  // there — it stays as the elements the arc joins, only a transition
  // changes it (Entscheidung 315) —, else the Regelüberhöhung.
  const keptCant = configuring ? spliceKeptCant(picks, s.transitionOn) : null
  const cantKey = (speed, r) => `${speed}|${r}|${keptCant}`
  const [typedCant, setCant] = useDerivedField(cantKey(s.speed, radius),
    keptCant ?? Math.abs(computeAutoC(s.speed, Math.abs(Number(radius)))))
  // With the search, the cant is the one the radius found was solved
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
      // Which one departs is the splice's to find, not the order of the clicks.
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
  // radius typed nor the cant takes part — the search chooses both.
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
  // A request as the key carries it, solved: held to a spacing on the
  // service, with the neighbour's axis put in; else in the worker.
  const solveRequest = (req, signal) => (req.clearance
    ? withClearance({ ...req, clearance: { ...req.clearance, ref: axis } }, { signal })
    : solveSpliceInWorker(req, { signal }))
  useEffect(() => {
    if (!requestKey) return undefined
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const { neighbour: _n, ...req } = JSON.parse(requestKey)
        const a = await solveRequest(req, ctl.signal)
        const read = spliceFromAnswer(a, picks, req)
        setAnswer({ key: requestKey, splice: read })
        // Transitions just switched on take the Regellänge named, once.
        const sol = read.solutions?.find(x => solutionKey(x) === chosen) ?? read.solutions?.[0]
        setS(prev => settleLengths(prev, sol?.result?.lengths ?? read.lengths))
      } catch (err) {
        if (err?.name === 'AbortError') return
        const { neighbour } = JSON.parse(requestKey)
        setAnswer({ key: requestKey, splice: { error: neighbour ? 'splice_clearance_unavailable' : 'splice_error_failed' } })
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

  // The transition beside each pick, by pick, as the splice set it in the
  // chain it solved: its mode, its length and the rules on it (AP S.3) — and
  // where nothing fits, the rules' lengths all the same.
  const transitionRules = s.transitionOn.some(Boolean) ? solution?.result?.lengths ?? splice?.lengths ?? null : null

  const reset = () => {
    preview.clear(); setPicks([]); setChosen(null); setPickStatus(null); setRefTrackId(null); setPickingRef(false)
  }

  // Ways out of a curvature jump the rules reject, searched once asked for
  // and only for the request they were searched for.
  const [remedies, setRemedies] = useState(null)   // { key, busy } | { key, list }
  const remedyState = remedies?.key === requestKey ? remedies : null
  const askRemedies = async () => {
    const key = requestKey
    setRemedies({ key, busy: true })
    try {
      const { neighbour: _n, ...request } = JSON.parse(key)
      const list = await spliceRemedies({
        request, key: solutionKey(solution), elements: solution.result.elements, findings: solution.result.findings,
        solve: (req) => solveRequest(req),
      })
      setRemedies(prev => (prev?.key === key ? { key, list } : prev))
    } catch {
      setRemedies(prev => (prev?.key === key ? null : prev))
    }
  }
  // A proposal taken over: the cant stays what it was solved with, though
  // speed or radius — the inputs it follows — change with it.
  const adoptRemedy = (r) => {
    if (r.kind === 'speed') {
      setPicks(prev => prev.map(p => ((p.speed ?? 0) > r.speed
        ? { ...p, speed: r.speed, speedBefore: p.speedBefore ?? p.speed } : p)))
      const speed = Number(s.speed) > r.speed ? r.speed : s.speed
      set('speed', speed)
      setCant(cant, cantKey(speed, radius))
    } else if (r.kind === 'radius') {
      set('radius', r.radius)
      setCant(cant, cantKey(s.speed, r.radius))
    } else {
      setS(prev => ({ ...prev, transitionOn: [true, true], modes: ['regular', 'regular'], transitions: SPLICE_DEFAULTS.transitions }))
    }
  }

  // Two arcs joined the other way than asked for: that way taken over as the
  // setting — over a straight with the transitions the solution has.
  const adopt = (sol) => {
    setChosen(solutionKey(sol))
    setS(prev => ({ ...prev, ...adoptedSettings(sol) }))
  }

  const handleCommit = () => {
    const commit = buildSplice({ tracks: loadTracks(), solution, speed: s.speed, cant })
    if (!commit) return
    commitSwitchConnection(commit)
    reset()
  }

  if (configuring) {
    const departure = solution?.dep ?? picks[0]
    // What the catalogue found on the stretch the solution writes: any error
    // there holds the commit back (Entscheidung 52, 177).
    const ruleError = (solution?.result?.findings ?? []).some(f => severityRank(f.severity) >= severityRank('error'))
    const status = splice ? spliceMessage(t, fill, splice, solution) : { msg: t('splice_solving'), error: false }
    const refName = refTrackId ? trackName(loadTracks().find(tr => tr.id === refTrackId)) : null
    const pickNames = picks.map(p => trackName(loadTracks().find(tr => tr.id === p.trackId)) || p.label)
    const spacingMsg = keeping && solution ? spacingMessage(t, fill, spacing, refName) : null
    // Asked for, a spacing not kept — or not yet known — holds the commit back.
    const spacingHolds = !s.clearanceOn || (keeping && spacing?.kept === true)
    return (
      <>
        <h2>{t('splice_element')}</h2>
        <SpliceSettings picks={picks} departure={departure} s={s} set={set} cant={cant} setCant={setCant} keptCant={keptCant}
          transitionLength={solution?.result?.transitionLength} transitionRules={transitionRules} maximize={maximize} found={found}>
          {withClearance && (
            <ClearanceFields on={s.clearanceOn} onToggle={v => set('clearanceOn', v)} refName={refName}
              picking={pickingRef} onPick={() => setPickingRef(p => !p)} dMin={s.clearanceDMin} onDMin={v => set('clearanceDMin', v)}>
              {!bothArcs ? (
                <label className="transition-curve-row">
                  <input type="checkbox" checked={s.clearanceMax} onChange={e => set('clearanceMax', e.target.checked)} />
                  <span>{t('splice_clearance_max')}</span>
                </label>
              ) : (
                <p className="msg-hint">{t('splice_clearance_arcs')}</p>
              )}
            </ClearanceFields>
          )}
        </SpliceSettings>
        {solution && (solutions.length > 1 || solution.result.alternative) && (
          <SolutionSwitch solutions={solutions} solution={solution} picks={picks}
            onChoose={sol => setChosen(solutionKey(sol))} onAdopt={adopt} />
        )}
        {splice?.requested && (
          <p className="msg-hint">
            {fill('splice_requested_failed', { join: t(`splice_arc_join_${s.arcJoin}`) })}{' '}
            {spliceErrorText(t, fill, splice.requested.error, splice.requested.params)}
          </p>
        )}
        {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
        {spacingMsg && <p className={spacingMsg.error ? 'msg-error' : 'msg-info'}>{spacingMsg.msg}</p>}
        {solution && <SpliceFindings result={solution.result} />}
        {solution && !maximize && hasJumpError(solution.result.findings) && (
          <SpliceRemedies state={remedyState} picks={picks} names={pickNames} onAsk={askRemedies} onAdopt={adoptRemedy} />
        )}
        {picks.some(p => p.speedBefore != null) && (
          <p className="msg-info">
            {fill('splice_speed_lowered', {
              list: picks.map((p, k) => p.speedBefore != null && `${pickNames[k]} ${p.speedBefore} → ${p.speed} km/h`).filter(Boolean).join(', '),
            })}
          </p>
        )}
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
