import { useEffect, useMemo, useState } from 'react'
import { loadTracks, loadSwitches, loadEndMarks, commitSwitchConnection } from '../../../storage'
import { wgs84ToUTM } from '../../../utils/geometry'
import { SWITCH_PICK_TYPES, DEFAULT_SWITCH_TYPE_IDX, clickStation, connectionAnchor } from '../../../utils/switch'
import {
  computeSwitchCant, computeCantDef, computeCantDefSigned, switchCantError, MAX_SWITCH_CANT_DEF,
} from '../../../utils/rules'
import { buildSwitchConnect, switchConnectOutcome, switchConnectSolutions } from '../../../utils/commands'
import { trackLabel } from '../../../utils/track'
import SwitchNumberField from '../SwitchNumberField'
import SwitchCantField from './SwitchCantField'
import SwitchFormField from './SwitchFormField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import RuleFindings from '../RuleFindings'
import ConnectRemedies from './ConnectRemedies'
import { SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS, buildLinesGeoJSON, buildFillGeoJSON } from '../../../map/switchPreview'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'
import SwitchOrientationPicker from '../../form/SwitchOrientationPicker'
import ReadOnlyField from '../../form/ReadOnlyField'
import AdvancedInfo from '../../form/AdvancedInfo'
import FormSection from '../../form/FormSection'
import { firstReason } from '../../form/firstReason'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'
import { elementText } from './connectText'

/**
 * "Weiche an Gleis anschließen" (Entscheidungen 302–304): a turnout laid into a
 * track whose branch runs into the open end of another one. First the host
 * track is clicked — where, is where the turnout's toe is looked for first —
 * then the end to connect. The element at that end takes a new length and
 * radius, and the turnout slides along the host, until the branch's end and
 * the element meet tangentially; the branch then becomes part of that track.
 *
 * Form, speed, cant and number as in "Weiche auf Gleis". Direction and side
 * start on the solution nearest to the click on the side the connected track
 * lies on; switching them shows the nearest solution there.
 */
export default function SwitchConnectForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const [stem, setStem]       = useState(null)   // { trackId, station } — the host and where it was clicked
  const [end, setEnd]         = useState(null)   // { trackId, endpoint } — the end to connect
  const [pickError, setPickError] = useState(null)
  const [switchTypeIdx, setTypeIdx] = useState(DEFAULT_SWITCH_TYPE_IDX)
  const [speed, setSpeed]     = useState(SWITCH_PICK_TYPES[DEFAULT_SWITCH_TYPE_IDX].speed)
  const [choice, setChoice]   = useState(null)   // { reversed, side } once the user turned one
  // A suggestion taken over (Entscheidung 314): { key, lead, speedLimit, solution } — it holds for
  // the form, direction and side it was made for (`key`) and lapses with any of them.
  const [adjusted, setAdjusted] = useState(null)
  const [cantEdit, setCantEdit] = useState(null) // { key, value }
  const [cantReason, setCantReason] = useState('')
  const [commitError, setCommitError] = useState(null)
  const switchNo = useSwitchNumber(project.id)
  const preview = usePreview(SWITCH_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  const phase = !stem ? 'stem' : !end ? 'end' : 'config'
  const sw = SWITCH_PICK_TYPES[switchTypeIdx]

  // ── Picks ────────────────────────────────────────────────────────────────
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
      // The end of the clicked element that is a track end; of a track of one
      // element, the one nearer the click.
      let endpoint = elementIndex === n - 1 ? 'END' : elementIndex === 0 ? 'BEGIN' : null
      if (n === 1) {
        const c = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
        const d = (node) => Math.hypot(node[0] - c.easting, node[1] - c.northing)
        endpoint = d(track.elements[0].endNode) < d(track.elements[0].startNode) ? 'END' : 'BEGIN'
      }
      if (!endpoint) { setPickError('switch_connect_not_end'); return }
      setEnd({ trackId, endpoint })
      setPickError(null)
      setChoice(null)
    },
  })

  // ── The solution ─────────────────────────────────────────────────────────
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
    ? switchConnectSolutions({ track, clickStation: stem.station, anchor, sw })
    : null), [anchor, track, stem, sw])
  const combo = choice ?? (found?.preferred ? { reversed: found.preferred.reversed, side: found.preferred.side } : null)
  const baseSolution = found && combo
    ? found.solutions.find(s => s.reversed === combo.reversed && s.side === combo.side) ?? null
    : null
  const adjustKey = `${end?.trackId}|${end?.endpoint}|${switchTypeIdx}|${combo?.reversed}|${combo?.side}`
  const adjust = adjusted?.key === adjustKey ? adjusted : null
  const solution = adjust?.lead ? adjust.solution : baseSolution
  const speedLimit = adjust?.speedLimit ?? null
  const outcome = useMemo(() => (solution
    ? switchConnectOutcome({ track, target, anchor, solution, speed, speedLimit })
    : null), [solution, track, target, anchor, speed, speedLimit])

  // The suggestions solve again with a transition before the arc: near the
  // solution shown, the same way round; each length once.
  const comboReversed = combo?.reversed, comboSide = combo?.side
  const outcomeFor = useMemo(() => {
    if (!baseSolution) return null
    const only = { reversed: comboReversed, side: comboSide }
    const byLead = new Map()
    const solve = (lead) => {
      if (!byLead.has(lead)) {
        byLead.set(lead, switchConnectSolutions({
          track, clickStation: baseSolution.x, anchor, sw, lead, only, reach: lead + 60,
        }).solutions[0] ?? null)
      }
      return byLead.get(lead)
    }
    return ({ lead, speedLimit: limit }) => {
      const s = lead > 0 ? solve(lead) : baseSolution
      return s && switchConnectOutcome({ track, target, anchor, solution: s, speed, speedLimit: limit })
    }
  }, [baseSolution, track, target, anchor, sw, comboReversed, comboSide, speed])
  const adopt = (r) => {
    const s = r.lead > 0 ? switchConnectSolutions({
      track, clickStation: baseSolution.x, anchor, sw, lead: r.lead, only: combo, reach: r.lead + 60,
    }).solutions[0] : null
    setCommitError(null)
    setAdjusted({ key: adjustKey, lead: r.lead, speedLimit: r.speedLimit, solution: s })
  }

  // ── Cant: as "Weiche auf Gleis" — the form's on a straight, the track's in a curve ──
  const placement = solution?.at.placement ?? null
  const plain = placement?.plain ?? true
  const place = placement?.place ?? null
  const cantKey = `${speed}|${switchTypeIdx}`
  const cant = plain || !place
    ? (cantEdit?.key === cantKey ? cantEdit.value : computeSwitchCant(speed, sw.R))
    : place.cantAt(0)
  const worstCant = plain || !place ? Math.abs(cant)
    : place.spans.reduce((m, sp) => Math.max(m, Math.abs(sp.cantStart), Math.abs(sp.cantEnd)), 0)
  const g = placement?.geom ?? null
  const worstDef = (segments) => Math.max(...segments.flatMap((seg, i) => [
    computeCantDefSigned(speed, seg.r1, place.cantAt(seg.s0, i)),
    computeCantDefSigned(speed, seg.r2, place.cantAt(seg.s0 + seg.length, i)),
  ]))
  const [stemRoute, branchRoute] = g?.swapped ? [g.branchSegments, g.stemSegments] : [g?.stemSegments, g?.branchSegments]
  const cantDef = plain ? computeCantDef(speed, sw.R, cant) : g ? worstDef(branchRoute) : 0
  const stemDef = plain || !g ? 0 : worstDef(stemRoute)

  // ── Preview: the turnout and the refitted element ─────────────────────────
  useEffect(() => {
    const geom = g?.swapped ?? g
    const lines = geom ? buildLinesGeoJSON(geom) : null
    if (lines && outcome) {
      for (const el of [outcome.lead, outcome.element].filter(Boolean)) {
        lines.features.push({ type: 'Feature', properties: {}, geometry: el.geometry })
      }
    }
    preview.set(SWITCH_LINES_SOURCE, lines)
    preview.set(SWITCH_FILL_SOURCE, geom ? buildFillGeoJSON(geom) : null)
  }, [g, outcome, preview])

  const reset = () => {
    preview.clear(); setStem(null); setEnd(null); setChoice(null); setAdjusted(null); setPickError(null); setCommitError(null)
  }
  const handleCancel = () => { reset(); onCommitted?.() }

  // ── What holds the commit back ─────────────────────────────────────────────
  const remnant = outcome?.remnant
  const errors = []
  if (anchored?.error) errors.push(t(anchored.error))
  else if (found && !solution) errors.push(t('switch_connect_no_solution'))
  if (remnant?.short) {
    errors.push(fill('switch_on_track_min_element_short', {
      l: remnant.length.toFixed(2), lmin: remnant.lMin.toFixed(2), v: String(remnant.speed),
    }))
  }
  if (remnant?.shortAhead) {
    errors.push(fill('switch_on_track_min_element_short_ahead', {
      l: remnant.ahead.toFixed(2), lmin: remnant.lMin.toFixed(2), v: String(remnant.speed),
    }))
  }
  if (outcome?.ruleError) errors.push(t('switch_connect_rule_error'))
  const cantErr = switchCantError(worstCant, cantReason)
  if (cantErr) errors.push(t(`switch_cant_error_${cantErr}`))
  if (cantDef > MAX_SWITCH_CANT_DEF || stemDef > MAX_SWITCH_CANT_DEF) errors.push(t('switch_cant_def_error'))
  if (commitError) errors.push(commitError)

  const handleCommit = () => {
    if (!solution || errors.length) return
    if (!switchNo.claim()) return
    const commit = buildSwitchConnect({
      track, target, anchor, solution, tracks: loadTracks(), sw, cant, cantReason, speed,
      switchName: switchNo.name, switchNumber: switchNo.number, speedLimit,
    })
    if (commit.noRoom) { setCommitError(fill('switch_on_track_no_room', { m: commit.noRoom.toFixed(1) })); return }
    commitSwitchConnection(commit)
    switchNo.reset()
    reset()
    onCommitted?.()
  }

  if (phase !== 'config') {
    return (
      <>
        <p>{t(phase === 'stem' ? 'switch_connect_hint_stem' : 'switch_connect_hint_end')}</p>
        {track && <p className="msg-info">{t('switch_connect_stem')}: {trackLabel(track)}</p>}
        {pickError && <p className="form-error">{t(pickError)}</p>}
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel} />
      </>
    )
  }

  const set = (next) => { setCommitError(null); setChoice({ ...combo, ...next }) }
  return (
    <>
      <SwitchOrientationPicker reversed={combo?.reversed ?? false} side={combo?.side ?? 'left'} onChange={next => set(next)} />

      <FormSection title={t('section_geometry')}>
        <SwitchFormField value={switchTypeIdx} onChange={i => {
          setCommitError(null); setTypeIdx(i); setSpeed(SWITCH_PICK_TYPES[i].speed)
        }} />
        <div className="form-field">
          <label>{splitUnit(t('field_speed')).text}</label>
          <NumberInput min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} unit="km/h" />
        </div>
        <SwitchCantField cant={cant} onCant={value => setCantEdit({ key: cantKey, value })}
          inherited={!plain} magnitude={worstCant} reason={cantReason} onReason={setCantReason} />
        <AdvancedInfo>
          <ReadOnlyField label={t('switch_connect_stem')} value={trackLabel(track)} />
          <ReadOnlyField label={t('switch_connect_target')} value={trackLabel(target)} />
          <ReadOnlyField label={t('switch_on_track_station')}
            value={solution ? `${solution.x.toFixed(3)} m (${fill('switch_connect_moved', { d: (solution.x - stem.station).toFixed(2) })})` : '–'} />
          <ReadOnlyField label={t('switch_connect_element_before')} value={elementText(t, target?.elements?.[anchor?.elIdx])} />
          <ReadOnlyField label={t('switch_connect_element_after')} value={elementText(t, outcome?.element)} />
          <ReadOnlyField type="number" label={plain ? t('cant_def') : t('switch_branch_cant_def')} value={cantDef} />
        </AdvancedInfo>
      </FormSection>

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      {found && found.solutions.length > 1 && (
        <p className="msg-hint">{fill('switch_connect_more', { n: String(found.solutions.length) })}</p>
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
