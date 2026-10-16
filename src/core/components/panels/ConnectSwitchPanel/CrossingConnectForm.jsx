import { useEffect, useMemo, useState } from 'react'
import { loadTracks, loadSwitches, loadEndMarks, commitSwitchConnection } from '../../../storage'
import { wgs84ToUTM } from '../../../utils/geometry'
import { CROSSING_TYPES, clickStation, connectionAnchor } from '../../../utils/switch'
import { buildCrossingConnect, crossingConnectOutcome, crossingConnectSolutions } from '../../../utils/commands'
import { trackLabel } from '../../../utils/track'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import SwitchNumberField from '../SwitchNumberField'
import RuleFindings from '../RuleFindings'
import ConnectRemedies from './ConnectRemedies'
import { SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS, buildCrossingPreview } from '../../../map/switchPreview'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'
import ReadOnlyField from '../../form/ReadOnlyField'
import AdvancedInfo from '../../form/AdvancedInfo'
import FormSection from '../../form/FormSection'
import { firstReason } from '../../form/firstReason'
import { elementText } from './connectText'

/**
 * "Kreuzung(-sweiche) an Gleis anschließen" (Entscheidung 307): a crossing or
 * crossing switch laid into a track, one end of its cross route running into
 * the open end of another one. Host first, then the end; the crossing point
 * slides along the host and the element at the end is refitted until it meets
 * the leg on its side tangentially — that leg becomes part of the connected
 * track, the other one a track of its own. The side the cross route leaves to
 * starts on the solution nearest to the click whose end lies on the connected
 * track's side; switching it shows the nearest solution there.
 */
export default function CrossingConnectForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const [stem, setStem]   = useState(null)   // { trackId, station }
  const [end, setEnd]     = useState(null)   // { trackId, endpoint }
  const [pickError, setPickError] = useState(null)
  const [formIdx, setFormIdx] = useState(() => Math.max(0, CROSSING_TYPES.findIndex(f => f.label === 'Kr 1:9')))
  const [side, setSide]   = useState(null)   // the cross route's side, once the user turned it
  // A suggestion taken over (Entscheidung 314), for the form and side it was made for.
  const [adjusted, setAdjusted] = useState(null)
  const [commitError, setCommitError] = useState(null)
  const form = CROSSING_TYPES[formIdx]
  const switchNo = useSwitchNumber(project.id, form.kind)
  const preview = usePreview(SWITCH_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })
  const phase = !stem ? 'stem' : !end ? 'end' : 'config'

  const formOptions = (klasse) => CROSSING_TYPES
    .map((f, i) => ({ f, i }))
    .filter(entry => entry.f.klasse === klasse)
    .map(({ f, i }) => <option key={i} value={i}>{f.label}</option>)

  useMapPick({
    active: phase === 'stem', hover: 'element', noSwitchBranch: true,
    onPick: ({ trackId, elementIndex }, e) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track?.elements?.[elementIndex]) return
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      setStem({ trackId, station: clickStation(track, elementIndex, clickUtm) })
      setPickError(null)
    },
  })
  useMapPick({
    active: phase === 'end', hover: 'element', noSwitchBranch: true,
    onPick: ({ trackId, elementIndex }, e) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      const n = track?.elements?.length ?? 0
      if (!n) return
      if (trackId === stem.trackId) { setPickError('switch_connect_same_track'); return }
      let endpoint = elementIndex === n - 1 ? 'END' : elementIndex === 0 ? 'BEGIN' : null
      if (n === 1) {
        const c = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
        const d = (node) => Math.hypot(node[0] - c.easting, node[1] - c.northing)
        endpoint = d(track.elements[0].endNode) < d(track.elements[0].startNode) ? 'END' : 'BEGIN'
      }
      if (!endpoint) { setPickError('switch_connect_not_end'); return }
      setEnd({ trackId, endpoint })
      setPickError(null)
      setSide(null)
    },
  })

  const tracks = loadTracks()
  const track  = stem ? tracks.find(tr => tr.id === stem.trackId) : null
  const target = end ? tracks.find(tr => tr.id === end.trackId) : null
  const anchored = useMemo(() => {
    if (!track || !target) return null
    if (Number(track.epsg) !== Number(target.epsg)) return { error: 'switch_connect_other_plane' }
    return connectionAnchor(target, end.endpoint, { tracks: loadTracks(), switches: loadSwitches(), endMarks: loadEndMarks() })
  }, [track, target, end])
  const anchor = anchored?.anchor ?? null
  const found = useMemo(() => (anchor && track
    ? crossingConnectSolutions({ track, clickStation: stem.station, anchor, form })
    : null), [anchor, track, stem, form])
  const crossSide = side ?? found?.preferred?.crossSide ?? 'right'
  const baseSolution = found?.solutions.find(s => s.crossSide === crossSide) ?? null
  const adjustKey = `${end?.trackId}|${end?.endpoint}|${formIdx}|${crossSide}`
  const adjust = adjusted?.key === adjustKey ? adjusted : null
  const solution = adjust?.lead ? adjust.solution : baseSolution
  const speedLimit = adjust?.speedLimit ?? null
  const outcome = useMemo(() => (solution ? crossingConnectOutcome({ target, anchor, solution, speedLimit }) : null),
    [solution, target, anchor, speedLimit])

  // The suggestions solve again near the solution shown, the same side and leg.
  const basePort = baseSolution?.port
  const outcomeFor = useMemo(() => {
    if (!baseSolution) return null
    const only = { crossSide, port: basePort }
    const byLead = new Map()
    const solve = (lead) => {
      if (!byLead.has(lead)) {
        byLead.set(lead, crossingConnectSolutions({
          track, clickStation: baseSolution.x, anchor, form, lead, only, reach: lead + 60,
        }).solutions[0] ?? null)
      }
      return byLead.get(lead)
    }
    return ({ lead, speedLimit: limit }) => {
      const s = lead > 0 ? solve(lead) : baseSolution
      return s && crossingConnectOutcome({ target, anchor, solution: s, speedLimit: limit })
    }
  }, [baseSolution, basePort, crossSide, track, target, anchor, form])
  const adopt = (r) => {
    const s = r.lead > 0 ? crossingConnectSolutions({
      track, clickStation: baseSolution.x, anchor, form, lead: r.lead, only: { crossSide, port: basePort }, reach: r.lead + 60,
    }).solutions[0] : null
    setCommitError(null)
    setAdjusted({ key: adjustKey, lead: r.lead, speedLimit: r.speedLimit, solution: s })
  }
  const g = solution?.at.placement.geom ?? null

  useEffect(() => {
    const pv = g ? buildCrossingPreview(g) : null
    for (const el of pv && outcome ? [outcome.lead, outcome.element].filter(Boolean) : []) {
      pv.lines.features.push({ type: 'Feature', properties: {}, geometry: el.geometry })
    }
    preview.set(SWITCH_LINES_SOURCE, pv?.lines ?? null)
    preview.set(SWITCH_FILL_SOURCE, pv?.fill ?? null)
  }, [g, outcome, preview])

  const reset = () => { preview.clear(); setStem(null); setEnd(null); setSide(null); setAdjusted(null); setPickError(null); setCommitError(null) }
  const handleCancel = () => { reset(); onCommitted?.() }

  const errors = []
  if (anchored?.error) errors.push(t(anchored.error))
  else if (found && !solution) errors.push(t('crossing_connect_no_solution'))
  if (outcome?.ruleError) errors.push(t('switch_connect_rule_error'))
  if (commitError) errors.push(commitError)

  const handleCommit = () => {
    if (!solution || errors.length) return
    if (!switchNo.claim()) return
    const commit = buildCrossingConnect({
      track, target, anchor, solution, tracks: loadTracks(), form,
      switchName: switchNo.name, switchNumber: switchNo.number, speedLimit,
    })
    if (commit.noRoom) { setCommitError(fill('crossing_on_track_no_room', { m: commit.noRoom.toFixed(1) })); return }
    commitSwitchConnection(commit)
    switchNo.reset()
    reset()
    onCommitted?.()
  }

  if (phase !== 'config') {
    return (
      <>
        <p>{t(phase === 'stem' ? 'crossing_connect_hint_stem' : 'switch_connect_hint_end')}</p>
        {track && <p className="msg-info">{t('switch_connect_stem')}: {trackLabel(track)}</p>}
        {pickError && <p className="form-error">{t(pickError)}</p>}
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel} />
      </>
    )
  }

  return (
    <>
      <FormSection title={t('section_geometry')}>
        <div className="form-field">
          <label>{t('crossing_form')}</label>
          <select value={formIdx} onChange={e => { setCommitError(null); setFormIdx(Number(e.target.value)) }}>
            <optgroup label={t('switch_form_regel')}>{formOptions('regel')}</optgroup>
            <optgroup label={t('switch_form_sonder')}>{formOptions('sonderbauform')}</optgroup>
          </select>
        </div>
        <div className="form-field">
          <label>{t('crossing_side')}</label>
          <select value={crossSide} onChange={e => { setCommitError(null); setSide(e.target.value) }}>
            <option value="right">{t('switch_side_right')}</option>
            <option value="left">{t('switch_side_left')}</option>
          </select>
        </div>
        <AdvancedInfo>
          <ReadOnlyField label={t('switch_connect_stem')} value={trackLabel(track)} />
          <ReadOnlyField label={t('switch_connect_target')} value={trackLabel(target)} />
          <ReadOnlyField label={t('crossing_on_track_station')}
            value={solution ? `${solution.x.toFixed(3)} m (${fill('switch_connect_moved', { d: (solution.x - stem.station).toFixed(2) })})` : '–'} />
          <ReadOnlyField label={t('crossing_connect_port')} value={solution ? solution.port : '–'} />
          <ReadOnlyField label={t('switch_connect_element_before')} value={elementText(t, target?.elements?.[anchor?.elIdx])} />
          <ReadOnlyField label={t('switch_connect_element_after')} value={elementText(t, outcome?.element)} />
        </AdvancedInfo>
      </FormSection>

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      {found && found.solutions.length > 1 && (
        <p className="msg-hint">{fill('crossing_connect_more', { n: String(found.solutions.length) })}</p>
      )}
      {outcome && <RuleFindings elements={outcome.chain} judge={outcome.judged} fields={false} />}
      {adjust && (
        <p className="msg-hint">
          {fill('connect_adjusted', { list: [
            adjust.lead > 0 && fill('connect_adjusted_lead', { l: adjust.lead.toFixed(1) }),
            adjust.speedLimit && fill('connect_adjusted_speed', { v: String(adjust.speedLimit) }),
          ].filter(Boolean).join(', ') })}{' '}
          <button type="button" className="link-btn" onClick={() => setAdjusted(null)}>{t('connect_adjusted_reset')}</button>
        </p>
      )}
      {outcome?.ruleError && outcomeFor && (
        <ConnectRemedies key={`${adjustKey}|${solution?.x}|${speedLimit}`} anchor={anchor}
          current={{ lead: adjust?.lead ?? 0, speedLimit }} outcome={outcome} outcomeFor={outcomeFor} onAdopt={adopt} />
      )}
      {errors.map(msg => <p key={msg} className="form-error">{msg}</p>)}

      <CommitBar onCommit={handleCommit} onCancel={handleCancel} disabled={!solution || errors.length > 0}
        reason={firstReason(...errors)} />
    </>
  )
}
