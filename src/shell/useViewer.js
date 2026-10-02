import { useState } from 'react'
import { api } from '../api/client'
import { commitVariantMerge, loadComparison, prepareVariantMerge } from '../utils/variantMerge'

/**
 * What is looked at read-only on the map, without a working copy (AP 10.8,
 * 10.10, R2.5): two states compared, a merge of one variant into another
 * being decided, or one revision —
 *   { kind: 'compare', title, subtitle, before, after, beforeLabel, afterLabel }
 *   { kind: 'merge', title, subtitle, prepared, sourceName, targetName }
 *   { kind: 'view', title, subtitle, record }
 * each with `back`, the page to return to. Also whose history is shown.
 *
 * `go(page)` switches the app's page; `say(text)` leaves a note on the start page.
 */
export default function useViewer({ t, fill, go, say }) {
  const [viewer, setViewer] = useState(null)
  const [busy, setBusy] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)   // { project, variant }

  const show = (v) => { setViewer(v); go('viewer') }
  const rev = (n) => fill('wc_rev', { n })

  const close = () => {
    go(viewer?.back ?? 'start')
    setViewer(null)
  }

  // A template only its admin edits: everyone else looks at its head, read-only.
  const viewVariant = async (serverProject, variant) => {
    say(null)
    const { payload, revision } = await api.head(variant.id)
    show({ kind: 'view', title: serverProject.title, record: payload, subtitle: `${variant.name} · ${rev(revision.number)}` })
  }

  const showComparison = async (serverProject, a, b) => {
    say(null)
    const { before, after } = await loadComparison(a.id, b.id)
    show({
      kind: 'compare', title: serverProject.title, subtitle: t('compare_title'),
      before: before.payload, after: after.payload,
      beforeLabel: `${a.name} · ${rev(before.revision.number)}`,
      afterLabel: `${b.name} · ${rev(after.revision.number)}`,
    })
  }

  const startMerge = async (serverProject, source, target) => {
    say(null)
    const prepared = await prepareVariantMerge(source.id, target.id)
    if (prepared.upToDate) return 'up_to_date'
    show({
      kind: 'merge', title: serverProject.title, prepared, sourceName: source.name, targetName: target.name,
      subtitle: fill('compare_from_to', { before: source.name, after: target.name }),
    })
    return 'shown'
  }

  const applyMerge = async (record) => {
    setBusy(true)
    try {
      const res = await commitVariantMerge(viewer.prepared, record,
        fill('merge_message', { source: viewer.sourceName, target: viewer.targetName }))
      say(res.stale
        ? t('merge_target_moved')
        : fill('merge_done', { source: viewer.sourceName, target: viewer.targetName, n: res.revision.number }))
    } catch (err) {
      say(err.body?.errors?.length ? t('checkin_refused') : t('collab_err_generic'))
    } finally {
      setBusy(false)
      close()
    }
  }

  // ── history (AP 10.10) ──
  const showHistory = (serverProject, variant) => {
    say(null)
    setHistoryFor({ project: serverProject, variant })
    go('history')
  }

  const viewRevision = async (r) => {
    const { payload } = await api.revision(r.id)
    show({
      kind: 'view', back: 'history', title: historyFor.project.title, record: payload,
      subtitle: `${historyFor.variant.name} · ${rev(r.number)}`,
    })
  }

  const compareWithHead = async (r, head) => {
    const [before, after] = await Promise.all([api.revision(r.id), api.revision(head.id)])
    show({
      kind: 'compare', back: 'history', title: historyFor.project.title, subtitle: t('compare_title'),
      before: before.payload, after: after.payload,
      beforeLabel: rev(r.number),
      afterLabel: `${rev(head.number)} (${t('history_head')})`,
    })
  }

  return {
    viewer, busy, historyFor, close,
    viewVariant, showComparison, startMerge, applyMerge, showHistory, viewRevision, compareWithHead,
  }
}
