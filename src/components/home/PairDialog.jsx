import { useState } from 'react'
import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

/**
 * Two variants of a project: the two states to compare (earlier, later), or
 * the source whose changes go into the target.
 */
export default function PairDialog({ kind, project, onCancel, onSubmit }) {
  const { t } = useI18n()
  const variants = project.variants.filter(v => !v.archived)
  const byId = new Map(variants.map(v => [v.id, v]))
  // A merge goes from a variant's parent into it by default, a comparison the same way round.
  const child = variants.find(v => v.parentVariantId && byId.has(v.parentVariantId)) ?? variants[1] ?? variants[0]
  const [a, setA] = useState(child?.parentVariantId && byId.has(child.parentVariantId) ? child.parentVariantId : variants[0]?.id)
  const [b, setB] = useState(child?.id ?? variants[0]?.id)
  const { busy, error, run } = useAction(t)
  const merge = kind === 'merge'
  return (
    <FormDialog title={t(merge ? 'home_merge_title' : 'home_compare_title')} submitLabel={t(merge ? 'home_merge' : 'home_compare')}
      busy={busy} canSubmit={a && b && a !== b} error={error} onCancel={onCancel}
      onSubmit={() => run(() => onSubmit(byId.get(a), byId.get(b)))}>
      {merge && <p className="collab-muted">{t('home_merge_desc')}</p>}
      <label className="collab-field">
        <span>{t(merge ? 'home_merge_source' : 'home_compare_before')}</span>
        <select value={a} onChange={e => setA(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="collab-field">
        <span>{t(merge ? 'home_merge_target' : 'home_compare_after')}</span>
        <select value={b} onChange={e => setB(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}
