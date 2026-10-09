import { crsLabel } from '../../utils/coordinateUtils'
import { cantDefLevel, computeCantDefSigned, maxSpeedFor, CANT_STEP } from '../../utils/rules/cant'
import { governing } from '../../utils/rules/speed'
import { useI18n } from '../../locales/i18nContext'
import { EditCell, TextCell } from './cells'
import { ruleById, severityLabelKey } from '../../utils/regelkatalog'
import {
  isTransition, typeLabel, switchNote, hintNote, cantNote, cantClass, defClass, defNote,
  ruleClass, ruleText, ruleNote, degText, lengthText, radiusText, comparisonRadiusText,
} from './rowText'

/**
 * One element of the table. `onEdit(key, raw)` gets what a cell was changed
 * to; the deficiency and the speed limit are derived and follow the speed,
 * cant and radius cells live. Length and radius show three decimals and keep
 * every one they have while typed. `joint` is the joint the element starts
 * with — its comparison radius and what the boundary rules said there, shown
 * in the last column on the line between this row and the one before.
 */
export default function TrackTableRow({ elements, i, sw, station, rules, joint, epsg, active, onActivate, onEdit }) {
  const { t, fill, language, num } = useI18n()
  const el = elements[i]
  const g = governing(elements, i)
  const cantDef = g ? computeCantDefSigned(el.speed ?? 0, g.radius, g.cant) : 0
  const vMax = g ? maxSpeedFor(el, g.radius, g.cant) : null
  const level = cantDefLevel(el, cantDef)
  const defTip = defNote(fill, el, level, cantDef, vMax)
  const edit = (key) => (raw) => onEdit(key, raw)
  const dimension = t('table_switch_dimension')

  return (
    // Clicking anywhere in the row activates it; onFocus covers tabbing into
    // one of its cells (React focus events bubble).
    <tr className={active ? 'track-table-row-active' : undefined} onClick={onActivate} onFocus={onActivate}>
      <td>{i + 1}</td>
      <td className={ruleClass(rules)} title={ruleNote(t, rules)}>{ruleText(t, rules)}</td>
      <td><TextCell value={lengthText(station, language)} /></td>
      <td title={hintNote(fill, el) ?? switchNote(t, el, sw)}>
        <TextCell value={typeLabel(t, el, sw)} wide className={el.switchHint ? 'track-table-input-exception' : ''} />
      </td>
      <td><TextCell value={degText(el.bearing, language)} /></td>
      <td><TextCell value={degText(el.endBearing, language)} /></td>
      {/* A switch route's length is its form's dimension: retyping it would
          move the turnout's ends while the record that states them stands still. */}
      <td title={el.switchBranch ? dimension : undefined}>
        {el.switchBranch
          ? <TextCell value={lengthText(el.length, language)} />
          : <EditCell value={el.length} onCommit={edit('length')} digits={3} />}
      </td>
      <td title={el.switchBranch && !isTransition(el) && el.radius ? dimension : undefined}>
        {isTransition(el)
          ? <TextCell value={radiusText(el, language)} wide />
          : el.switchBranch
            ? <TextCell value={el.radius ? lengthText(el.radius, language) : '–'} />
            : <EditCell value={el.radius} onCommit={edit('radius')} disabled={!el.radius} digits={3} />}
      </td>
      {/* The speed is the cell to change when the deficiency it makes is too
          high, so it carries the same mark. */}
      <td title={defTip}><EditCell value={el.speed} onCommit={edit('speed')} className={defClass(level)} /></td>
      {/* Cant ramps across a transition — its ends belong to the neighbouring
          elements, so there is nothing to edit here. */}
      <td title={cantNote(fill, el)}>
        {isTransition(el)
          ? <TextCell value="–" className={cantClass(el)} />
          : <EditCell value={el.cant} onCommit={edit('cant')} step={CANT_STEP} className={cantClass(el)} />}
      </td>
      {/* Only a switch route knows the 100 mm limit, so only there is there
          anything to justify — including a route laid into a cant ramp, whose
          own cant cell is not editable. */}
      <td title={el.switchBranch ? cantNote(fill, el) : undefined}>
        {el.switchBranch
          ? <EditCell value={el.cantException} onCommit={edit('cantException')} type="text" wide placeholder="–" className={cantClass(el)} />
          : <TextCell value="–" />}
      </td>
      <td title={defTip}><TextCell value={num(cantDef)} className={defClass(level)} /></td>
      <td><TextCell value={vMax ?? '–'} /></td>
      {/* The plane the whole track is stated in — one code per track, so the
          column says which frame these eastings and northings are in. */}
      <td title={crsLabel(epsg)}><TextCell value={epsg ?? '–'} /></td>
      {/* The joint this element starts with lies between its row and the one
          before, so its field stands on the line between the two. */}
      <td className="track-table-joint">
        {joint && (
          <div className="track-table-joint-field" title={jointNote(t, fill, i, joint)}>
            <TextCell value={comparisonRadiusText(joint.rw, language)}
              className={joint.severity && joint.severity !== 'ok' ? `rule-sev-${joint.severity}` : ''} />
          </div>
        )}
      </td>
    </tr>
  )
}

/** What the comparison radius cell says: which joint it is, and every boundary rule that fired there. */
function jointNote(t, fill, i, joint) {
  if (!joint) return t('table_comparison_radius_none')
  const fired = (joint.results ?? []).filter(r => r.severity !== 'ok')
    .map(r => `${r.id} · ${t(severityLabelKey(r.severity))}: ${ruleById(r.id)?.title ?? ''}`)
  return [fill('table_comparison_radius_at', { a: String(i), b: String(i + 1) }), ...fired].join('\n')
}
