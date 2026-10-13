import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection } from '../../core/storage'
import { MAX_CANT, computeAutoC } from '../../core/utils/rules/cant'
import { buildSplice, secondPickRefusal, spliceFromAnswer, splicePick, spliceRequest } from '../../core/utils/commands/splice'
import { ZOOM_LINE_WIDTH } from '../../core/map/style'
import { TRACKS_HOVER_LAYER } from '../../core/map/layerIds'
import usePreview from '../../core/map/usePreview'
import useMapPick from '../../core/map/useMapPick'
import useDerivedField from '../../core/hooks/useDerivedField'
import { useI18n } from '../../core/locales/i18nContext'
import { PALETTE } from '../../core/styles/palette'
import CommitBar from '../../core/components/form/CommitBar'
import CancelButton from '../../core/components/form/CancelButton'
import NumberInput from '../../core/components/form/NumberInput'
import CantField from '../../core/components/panels/CantField'
import ShiftValuesSection from '../../core/components/panels/shift/ShiftValuesSection'
import { comparedLine } from '../../core/utils/shiftValues'
import { localSplice } from './localSplice'

const PREVIEW_SOURCE = 'splice-preview-source'
const PREVIEW_LAYERS = [{
  sourceId: PREVIEW_SOURCE,
  layer: {
    id: 'splice-preview-layer', type: 'line',
    paint: { 'line-color': PALETTE.mapHover, 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] },
  },
}]

const line = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
})

/** Which solution is chosen: by the ends it joins. */
const solutionKey = (sol) => sol.result.ends.join()

/** A splice that does not fit, as a sentence: the error, and the radius that would. */
function errorText(t, fill, { error, params = {} }) {
  const text = t(error.startsWith('splice_error_') ? error : 'splice_error_no_fit')
  const hints = [
    params.rMax != null && fill('splice_r_max', { r: String(params.rMax) }),
    params.rMin != null && fill('splice_r_min', { r: String(params.rMin) }),
  ].filter(Boolean)
  return hints.length ? `${text}${/[.!?]$/.test(text) ? '' : '.'} ${hints.join(' ')}` : text
}

/** What the solution shown inserts: the arc's length and hand, or the straight's length. */
function solutionText(t, { result, dep, arr }) {
  if (result.straightLength != null) return `${t('splice_arrival')} ↔ ${t('splice_departure')}: ~${result.straightLength.toFixed(1)} m`
  const len = `${t('splice_arc_length')}: ~${result.arcLength.toFixed(1)} m`
  return dep.signedR != null || arr.signedR != null ? len : `${len} | ${t(result.signedR < 0 ? 'splice_left' : 'splice_right')}`
}

/**
 * "Zwei Gleise zusammenfügen" in the local build (decision 293): the service's
 * splice simplified — an arc of the radius given between two straights, a
 * straight between two arcs, a new arc between an arc and a straight, without
 * transitions, spacing or rule check — computed here in the browser
 * (localSplice). Two elements are picked in either order; which ends meet and
 * which track departs is found, the least rebuilt way first and the others to
 * step through. The merged track is one commit, as in the server's dialog.
 */
export default function LocalSplicePanel() {
  const { t, fill, num } = useI18n()
  const [picks, setPicks] = useState([])   // in the order they were clicked
  const [chosen, setChosen] = useState(null)
  const [radius, setRadius] = useState(500)
  const [speed, setSpeed] = useState('')
  const [pickStatus, setPickStatus] = useState(null)   // { msg, error }
  const configuring = picks.length === 2
  const bothArcs = configuring && picks[0].signedR != null && picks[1].signedR != null
  const [cant, setCant] = useDerivedField(`${speed}|${radius}`, Math.abs(computeAutoC(speed, Math.abs(Number(radius)))))

  const preview = usePreview(PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

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
        // The faster of the two (Entscheidung 181).
        setSpeed(Math.max(picks[0].speed ?? 0, pick.speed ?? 0) || '')
      }
      setPicks(picks.length === 1 ? [picks[0], pick] : [pick])
      setChosen(null)
      setPickStatus(null)
    },
  })

  // Computed here, at once: the answer for the picks and the radius.
  const splice = useMemo(
    () => (configuring ? spliceFromAnswer(localSplice(spliceRequest(picks[0], picks[1], { radius, speed, cant })), picks) : null),
    [configuring, picks, radius, speed, cant])
  const solutions = splice?.solutions ?? null
  const solution = solutions?.find(sol => solutionKey(sol) === chosen) ?? solutions?.[0] ?? null

  useEffect(() => {
    preview.set(PREVIEW_SOURCE, solution ? line(solution.result.previewCoords) : null)
  }, [solution, preview])

  // The track the splice would write and the stretch of it that is new —
  // what its shift values against a reference axis are read over (Paket V).
  const merged = useMemo(() => {
    if (!solution) return null
    const built = buildSplice({ tracks: loadTracks(), solution, speed, cant, newId: () => 'preview' })
    if (!built) return null
    const track = built.addTracks[0]
    const { first, last, from } = built.stretch
    return { track, line: comparedLine(track.elements.slice(first, last + 1), track.epsg, { heights: track.heights, station0: from }) }
  }, [solution, speed, cant])

  const reset = () => { preview.clear(); setPicks([]); setChosen(null); setPickStatus(null) }

  const handleCommit = () => {
    const commit = buildSplice({ tracks: loadTracks(), solution, speed, cant })
    if (!commit) return
    commitSwitchConnection(commit)
    reset()
  }

  if (!configuring) {
    return (
      <>
        <h2>{t('splice_element')}</h2>
        <p>{picks.length === 0 ? t('splice_hint_first') : t('splice_hint_second')}</p>
        {picks.length > 0 && <p className="msg-info">{t('splice_first_selected')}: {picks[0].label}</p>}
        {pickStatus && <p className={pickStatus.error ? 'msg-error' : 'msg-hint'}>{pickStatus.msg}</p>}
        <p className="selecting-hint">{t('splice_local_note')}</p>
        {picks.length === 1 && <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={reset} />}
      </>
    )
  }

  const i = solution ? solutions.indexOf(solution) : -1
  const step = (d) => setChosen(solutionKey(solutions[(i + d + solutions.length) % solutions.length]))
  const end = (k) => fill(solution.result.ends[k] === 'end' ? 'splice_at_end' : 'splice_at_start', { track: picks[k].label })
  return (
    <>
      <h2>{t('splice_element')}</h2>
      <div className="element-form">
        {!bothArcs && (
          <div className="form-field">
            <label>{t('field_radius')}</label>
            <NumberInput min={1} value={radius} onChange={e => setRadius(Number(e.target.value))} />
          </div>
        )}
        <div className="form-field">
          <label>{t('field_speed')}</label>
          <NumberInput min={0} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
        </div>
        {!bothArcs && (
          <CantField value={cant} onChange={setCant} min={0} max={MAX_CANT} speed={speed} radius={Math.abs(Number(radius))} />
        )}
      </div>
      {solution && (
        <div className="splice-solutions">
          {solutions.length > 1 && (
            <button type="button" className="panel-btn" aria-label={t('splice_solution_prev')} onClick={() => step(-1)}>◀</button>
          )}
          <span>
            {fill('splice_solution', { i: String(i + 1), n: String(solutions.length) })}: {end(0)} ↔ {end(1)}
            {' · '}{fill('splice_rebuilt', { l: num(solution.result.rebuilt, { digits: 0, unit: 'm' }) })}
          </span>
          {solutions.length > 1 && (
            <button type="button" className="panel-btn" aria-label={t('splice_solution_next')} onClick={() => step(1)}>▶</button>
          )}
        </div>
      )}
      {solution
        ? <p className="msg-info">{solutionText(t, solution)}</p>
        : <p className="msg-error">{errorText(t, fill, splice)}</p>}
      <p className="selecting-hint">{t('splice_local_note')}</p>
      {merged && (
        <ShiftValuesSection id="shift-splice" line={merged.line} epsg={merged.track.epsg} heightEpsg={merged.track.heightEpsg}
          heightNote={!merged.track.heights?.length ? t('shift_no_heights_track') : null} name={merged.track.name ?? ''} />
      )}
      <CommitBar onCommit={handleCommit} onCancel={reset} disabled={!solution} />
    </>
  )
}
