import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection } from '../../storage'
import { computeAutoC } from '../../utils/rules/cant'
import { hasRuleError } from '../../utils/trassierungCheck'
import { buildSplice, secondPickRefusal, solveSplice, splicePick } from '../../utils/commands/splice'
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
const SPLICE_PREVIEW_LAYERS = [{
  sourceId: SPLICE_PREVIEW_SOURCE,
  layer: {
    id: 'splice-preview-layer', type: 'line',
    paint: { 'line-color': PALETTE.mapHover, 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] },
  },
}]

const line = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
})

const DEFAULTS = {
  radius: 500, speed: 0,
  clothoidEnabled: false, transitionType: 'clothoid',   // 'clothoid' | 'bloss'
  // Two arcs can be joined either by a straight between them or by a single
  // transition curve straight from one to the other (AP 4.1).
  arcJoin: 'straight',                                  // 'straight' | 'transition'
  clothoidDep: 60, clothoidArr: 60,
}

/** What the dialog says about a solved splice. */
function spliceMessage(t, splice) {
  if (splice.error) return { msg: t(splice.error), error: true }
  const { result, arcMode, Ld, La } = splice
  const tr = (Ld > 0 || La > 0) ? ` | ${t('transition_curve')}: ${Ld}+${La} m` : ''
  if (result.transitionLength != null) {
    return { msg: `${t(result.compound ? 'splice_compound' : 'splice_reverse')}: ${t('transition_curve')} ~${result.transitionLength.toFixed(1)} m`, error: false }
  }
  if (result.straightLength != null) {
    return { msg: `${t('splice_arrival')} ↔ ${t('splice_departure')}: ~${result.straightLength.toFixed(1)} m${tr}`, error: false }
  }
  const len = `${t('splice_arc_length')}: ~${result.arcLength.toFixed(1)} m${tr}`
  return { msg: arcMode ? len : `${len} | ${result.curveSide}`, error: false }
}

/**
 * Splice two tracks into one (R5.5: the construction and the commit are in
 * utils/commands/splice). Two elements are picked — departure, then arrival —
 * and joined by an arc, re-shaped arcs or a transition; the merged track is
 * one commit.
 */
export default function SpliceElementPanel() {
  const { t } = useI18n()
  const [picks, setPicks] = useState([])   // the departure pick, then the arrival
  const [s, setS] = useState(DEFAULTS)
  const set = (key, value) => setS(prev => ({ ...prev, [key]: value }))
  // The radius is a magnitude here, so the cant is one too. It follows speed
  // and radius unless the user overrode it for that pair.
  const [cant, setCant] = useDerivedField(`${s.speed}|${s.radius}`, Math.abs(computeAutoC(s.speed, Math.abs(Number(s.radius)))))
  const [pickStatus, setPickStatus] = useState(null)   // { msg, error }
  const configuring = picks.length === 2

  const preview = usePreview(SPLICE_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

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
      setPicks([...picks, pick])
      setPickStatus(null)
    },
  })

  // The preview and the commit read the same construction, so they cannot disagree.
  const splice = useMemo(() => (configuring ? solveSplice(picks[0], picks[1], s) : null), [configuring, picks, s])

  useEffect(() => {
    preview.set(SPLICE_PREVIEW_SOURCE, splice?.result ? line(splice.result.previewCoords) : null)
  }, [splice, preview])

  const reset = () => { preview.clear(); setPicks([]); setPickStatus(null) }

  const handleCommit = () => {
    const commit = buildSplice({
      tracks: loadTracks(), dep: picks[0], arr: picks[1], splice,
      speed: s.speed, cant, clothoidEnabled: s.clothoidEnabled,
    })
    if (!commit) return
    commitSwitchConnection(commit)
    reset()
  }

  if (configuring) {
    const [departure, arrival] = picks
    const bothArcs = departure.signedR != null && arrival.signedR != null
    // Only the inserted arc takes a cant; an arc+arc splice re-shapes the two
    // existing arcs, which keep theirs — and inserts no element of its own, so
    // there is nothing for the catalogue to judge in that case. The length
    // judged is the one the construction solved, not one that was typed.
    const inserted = !bothArcs && splice?.result?.arcLength != null
      ? { elementType: 1, radius: Number(s.radius), cant, speed: s.speed, length: splice.result.arcLength }
      : null
    const status = splice ? spliceMessage(t, splice) : null
    return (
      <>
        <h2>{t('splice_element')}</h2>
        <SpliceSettings departure={departure} arrival={arrival} s={s} set={set} cant={cant} setCant={setCant}
          transitionLength={splice?.result?.transitionLength} />
        {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
        {inserted && <RuleFindings element={inserted} />}
        <CommitBar onCommit={handleCommit} onCancel={reset}
          disabled={!splice?.result || (inserted ? hasRuleError([inserted]) : false)} />
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
