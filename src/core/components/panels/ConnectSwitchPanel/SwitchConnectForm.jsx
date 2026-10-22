import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { loadTracks, loadSwitches, loadEndMarks, commitSwitchConnection } from '../../../storage'
import { wgs84ToUTM } from '../../../utils/geometry'
import {
  SWITCH_PICK_TYPES, DEFAULT_SWITCH_TYPE_IDX, clickStation, connectionAnchor, END_CHAIN_OPEN, endChainDefault,
  endChainOpen, negR,
} from '../../../utils/switch'
import {
  computeSwitchCant, computeCantDef, computeCantDefSigned, switchCantError, MAX_SWITCH_CANT_DEF,
} from '../../../utils/rules'
import { buildSwitchConnect, switchConnectChainSolutions, switchConnectOutcome, switchConnectSolutions } from '../../../utils/commands'
import { trackLabel, trackLength } from '../../../utils/track'
import SwitchNumberField from '../SwitchNumberField'
import SwitchCantField from './SwitchCantField'
import SwitchFormField from './SwitchFormField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import RuleFindings from '../RuleFindings'
import ConnectRemedies from './ConnectRemedies'
import MidChainFields from './MidChainFields'
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
 *
 * With two elements (Entscheidung 377) the last two at the open end are laid
 * anew, each of a chosen type, its length and radius given or sought as in the
 * switch connection; the turnout's toe is a fourth such value — three are
 * sought.
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
  // How many elements at the open end change (Entscheidung 377), and with two
  // the spec of them and the toe's station as typed ('' = sought) — both for
  // the end they were made at (`key`).
  const [count, setCount] = useState(1)
  const [chainEdit, setChainEdit] = useState(null) // { key, mids }
  const [toeEdit, setToeEdit] = useState(null)     // { key, value }
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
    return connectionAnchor(target, end.endpoint, { tracks: loadTracks(), switches: loadSwitches(), endMarks: loadEndMarks(), count })
  }, [track, target, end, count])
  const anchor = anchored?.anchor ?? null

  // ── Two elements: the spec, the toe, how many values are sought ──────────
  const chainKey = `${end?.trackId}|${end?.endpoint}`
  const chainDefault = useMemo(() => (count === 2 && anchor ? endChainDefault(anchor) : null), [count, anchor])
  const mids = chainEdit?.key === chainKey ? chainEdit.mids : chainDefault
  const toeText = toeEdit?.key === chainKey ? toeEdit.value : ''
  const toeValue = toeText === '' ? null : Number(toeText)
  const toeStation = Number.isFinite(toeValue) && track && toeValue >= 0 && toeValue <= trackLength(track) ? toeValue : null
  const chainOpen = mids ? endChainOpen(mids) + (toeText === '' ? 1 : 0) : 0
  const deferredMids = useDeferredValue(mids)
  const deferredToe = useDeferredValue(toeStation)
  const deferredOpen = deferredMids ? endChainOpen(deferredMids) + (deferredToe == null ? 1 : 0) : 0

  const found = useMemo(() => {
    if (!anchor || !track) return null
    if (count === 1) return switchConnectSolutions({ track, clickStation: stem.station, anchor, sw })
    if (!deferredMids || deferredOpen !== END_CHAIN_OPEN) return null
    return switchConnectChainSolutions({
      track, clickStation: stem.station, anchor, sw, mids: deferredMids, station: deferredToe, only: choice,
    })
  }, [anchor, track, stem, sw, count, deferredMids, deferredOpen, deferredToe, choice])
  const combo = choice ?? (found?.preferred ? { reversed: found.preferred.reversed, side: found.preferred.side } : null)
  const baseSolution = found && combo
    ? found.solutions.find(s => s.reversed === combo.reversed && s.side === combo.side) ?? null
    : null
  const adjustKey = `${end?.trackId}|${end?.endpoint}|${switchTypeIdx}|${combo?.reversed}|${combo?.side}|${count}`
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
  const worstDef = (segments) => Math.max(...segments.flatMap((seg) => [
    computeCantDefSigned(speed, seg.r1, place.cantAt(seg.s0, seg)),
    computeCantDefSigned(speed, seg.r2, place.cantAt(seg.s0 + seg.length, seg)),
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
    setChainEdit(null); setToeEdit(null)
  }
  const handleCancel = () => { reset(); onCommitted?.() }

  // ── What holds the commit back ─────────────────────────────────────────────
  // `hard` has nothing to build; `rules` only the rulebook against it, which
  // may be committed all the same (Entscheidung 361).
  const remnant = outcome?.remnant
  const hard = []
  const rules = []
  if (anchored?.error) hard.push(t(anchored.error))
  else if (count === 2 && chainOpen !== END_CHAIN_OPEN) hard.push(t('connect_chain_unknowns'))
  else if (count === 2 && toeText !== '' && toeStation == null) hard.push(t('switch_connect_toe_off'))
  else if (found?.error) hard.push(t(found.error))
  else if (found && !solution) hard.push(t(count === 2 ? 'switch_connect_chain_no_solution' : 'switch_connect_no_solution'))
  if (remnant?.short) {
    rules.push(fill('switch_on_track_min_element_short', {
      l: remnant.run.toFixed(2), lmin: remnant.lMin.toFixed(2), v: String(remnant.speed),
    }))
  }
  if (remnant?.shortAhead) {
    rules.push(fill('switch_on_track_min_element_short_ahead', {
      l: remnant.runAhead.toFixed(2), lmin: remnant.lMin.toFixed(2), v: String(remnant.speed),
    }))
  }
  if (outcome?.ruleError) rules.push(t('switch_connect_rule_error'))
  const cantErr = switchCantError(worstCant, cantReason)
  if (cantErr) rules.push(t(`switch_cant_error_${cantErr}`))
  if (cantDef > MAX_SWITCH_CANT_DEF || stemDef > MAX_SWITCH_CANT_DEF) rules.push(t('switch_cant_def_error'))
  if (commitError) hard.push(commitError)
  const errors = [...hard, ...rules]
  const overridable = !!solution && hard.length === 0 && rules.length > 0

  const handleCommit = (force = false) => {
    if (!solution || hard.length || (rules.length && !force)) return
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
  // The solved pieces run from the fixed node; the rows stand in the track's
  // order and direction.
  const pieces = solution?.fit.pieces ?? null
  const solvedRows = !pieces ? null : end.endpoint === 'END' ? pieces
    : [...pieces].reverse().map(p => ({ length: p.length, r1: negR(p.r2), r2: negR(p.r1) }))
  const rowLabels = mids?.map((_, i) => {
    const n = String(anchor.elIdx + i + 1)
    const atOpen = end.endpoint === 'END' ? i === mids.length - 1 : i === 0
    return fill(atOpen ? 'switch_connect_chain_el_open' : 'switch_connect_chain_el', { n })
  })
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
        <div className="form-field">
          <label>{t('switch_connect_count')}</label>
          <select value={count} onChange={e => { setCommitError(null); setChoice(null); setCount(Number(e.target.value)) }}>
            <option value={1}>{t('switch_connect_count_1')}</option>
            <option value={2}>{t('switch_connect_count_2')}</option>
          </select>
        </div>
        {count === 2 && (
          <div className="form-field">
            <label>{t('switch_connect_toe')}</label>
            <NumberInput step="any" min="0" value={toeText} placeholder={t('scurve_mid_sought')}
              onChange={e => { setCommitError(null); setToeEdit({ key: chainKey, value: e.target.value }) }} unit="m" />
          </div>
        )}
        <AdvancedInfo>
          <ReadOnlyField label={t('switch_connect_stem')} value={trackLabel(track)} />
          <ReadOnlyField label={t('switch_connect_target')} value={trackLabel(target)} />
          <ReadOnlyField label={t('switch_on_track_station')}
            value={solution ? `${solution.x.toFixed(3)} m (${fill('switch_connect_moved', { d: (solution.x - stem.station).toFixed(2) })})` : '–'} />
          {count === 1 && (
            <>
              <ReadOnlyField label={t('switch_connect_element_before')} value={elementText(t, target?.elements?.[anchor?.elIdx])} />
              <ReadOnlyField label={t('switch_connect_element_after')} value={elementText(t, outcome?.element)} />
            </>
          )}
          <ReadOnlyField type="number" label={plain ? t('cant_def') : t('switch_branch_cant_def')} value={cantDef} />
        </AdvancedInfo>
      </FormSection>

      {count === 2 && mids && (
        <MidChainFields mids={mids} solved={solvedRows} title={t('switch_connect_chain')} labels={rowLabels}
          onChange={next => { setCommitError(null); setChainEdit({ key: chainKey, mids: next }) }}
          status={{
            ok: chainOpen === END_CHAIN_OPEN,
            text: fill('switch_connect_chain_open', { n: String(chainOpen), need: String(END_CHAIN_OPEN) }),
          }} />
      )}

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      {count === 1 && found && found.solutions.length > 1 && (
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
      {count === 1 && outcome?.ruleError && outcomeFor && (
        <ConnectRemedies key={`${adjustKey}|${solution?.x}|${speedLimit}`} anchor={anchor}
          current={{ lead: adjust?.lead ?? 0, speedLimit }} outcome={outcome} outcomeFor={outcomeFor} onAdopt={adopt} />
      )}
      {errors.map(msg => <p key={msg} className="form-error">{msg}</p>)}

      <CommitBar onCommit={handleCommit} onCancel={handleCancel} disabled={!solution || errors.length > 0}
        reason={firstReason(...errors)} onOverride={overridable ? () => handleCommit(true) : null} />
    </>
  )
}
