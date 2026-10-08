import { useCallback, useEffect, useState } from 'react'
import { closeWorkingCopy, currentWorkingCopy } from '../storage'
import { adoptUpdate, checkIn, localChanges, openVariant, prepareUpdate, revertToHead, serverHead } from '../utils/workingCopySync'
import { useProject } from '../hooks/useStore'
import { errorText } from '../components/collab/errorText'

// How often the open app asks whether the server has moved on [ms].
const SERVER_POLL = 2 * 60 * 1000
// How long the writes have to rest before the local changes are counted [ms].
const CHANGES_SETTLE = 400

/**
 * The open working copy against the server (AP 10.6, R2.5): which variant it
 * is, its own changes, whether the server has moved on, and checking in and
 * updating, and throwing the local changes away.
 *
 *   wc           { project, variant } — the server's project and variant, or null
 *   changes      the local changes (diff entries)
 *   base         the revision the working copy rests on; serverNewer when the head moved on
 *   syncDialog   { kind: 'checkin', errors } | { kind: 'merge', prepared, then } | { kind: 'discard' } | null
 *   busy, note   a sync running; a one-line word about the last one
 *
 *   replaced     counts the updates and discards that put another record in
 *                place of the working copy — whatever held onto the old one
 *                (the element table) has to let go
 */
export default function useWorkingCopy({ t }) {
  const project = useProject()
  const [wc, setWc] = useState(null)
  const [changes, setChanges] = useState([])
  const [head, setHead] = useState(null)
  const [syncDialog, setSyncDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [replaced, setReplaced] = useState(0)

  // The working copy's own changes, once the writes have come to rest: the
  // diff runs over the whole project, so a burst of writes (a drag, an
  // import) is counted once at its end rather than after every step (R1.6).
  useEffect(() => {
    if (!wc) { setChanges([]); return undefined }
    const timer = setTimeout(() => setChanges(localChanges()), CHANGES_SETTLE)
    return () => clearTimeout(timer)
  }, [wc, project])

  // Whether the server has moved on: on opening, every few minutes, and when
  // the tab comes back.
  useEffect(() => {
    if (!wc) return undefined
    let alive = true
    const check = () => serverHead(wc.variant.id)
      .then(h => { if (alive) setHead(h) })
      .catch(() => {})
    check()
    const timer = setInterval(check, SERVER_POLL)
    const onFocus = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onFocus) }
  }, [wc])

  // Leaving the tab with changes not checked in is asked about by the browser.
  useEffect(() => {
    if (!changes.length) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [changes.length])

  const open = useCallback(async (serverProject, variant) => {
    await openVariant(variant.id)
    setWc({ project: serverProject, variant })
    setHead(null)
    setNote(null)
  }, [])

  const close = useCallback(async () => {
    setSyncDialog(null)
    await closeWorkingCopy()
    setWc(null)
  }, [])

  const base = wc ? currentWorkingCopy()?.base ?? null : null
  const serverNewer = Boolean(head && base && head.id !== base.id)

  /**
   * Merge the server's head into the working copy and show the result; `then`
   * runs once the user took it over (checking in again, after a stale base).
   */
  const startUpdate = async (then = null) => {
    setBusy(true)
    setNote(null)
    try {
      const prepared = await prepareUpdate()
      if (!prepared) {
        setNote(t('wc_up_to_date'))
        if (then) await then()
        return
      }
      setSyncDialog({ kind: 'merge', prepared, then })
    } catch {
      setNote(t('collab_err_generic'))
    } finally {
      setBusy(false)
    }
  }

  const applyMerge = async (record) => {
    const { prepared, then } = syncDialog
    adoptUpdate(prepared, record)
    setHead(prepared.head)
    setSyncDialog(null)
    setReplaced(n => n + 1)
    if (then) await then()
  }

  // The local changes thrown away: the working copy is the server's head again.
  const discardChanges = async () => {
    setBusy(true)
    setNote(null)
    try {
      const revision = await revertToHead()
      setHead(revision)
      setSyncDialog(null)
      setReplaced(n => n + 1)
      setNote(t('wc_discarded'))
    } catch {
      setSyncDialog(null)
      setNote(t('collab_err_generic'))
    } finally {
      setBusy(false)
    }
  }

  const submitCheckIn = async (message) => {
    setBusy(true)
    try {
      const res = await checkIn(message)
      if (res.stale) {
        // Someone checked in first: merge their head in, then try again.
        setSyncDialog(null)
        setBusy(false)
        await startUpdate(() => submitCheckIn(message))
        return
      }
      setSyncDialog(null)
      setHead(res.revision)
      setChanges(localChanges())
      setNote(t('wc_checked_in'))
    } catch (err) {
      setSyncDialog({ kind: 'checkin', errors: err.body?.errors ?? [] })
      if (!err.body?.errors) setNote(errorText(t, err.code))
    } finally {
      setBusy(false)
    }
  }

  return {
    wc, changes, base, head, serverNewer, syncDialog, busy, note, replaced,
    open, close, startUpdate, applyMerge, submitCheckIn, discardChanges,
    askCheckIn: () => setSyncDialog({ kind: 'checkin', errors: [] }),
    askDiscard: () => setSyncDialog({ kind: 'discard' }),
    cancelDialog: () => setSyncDialog(null),
    clearNote: () => setNote(null),
  }
}
