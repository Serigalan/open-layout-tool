import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

// A window closed on unmount is closed a moment later, so StrictMode's second
// mount — and any remount of the same window — can take it back.
const pendingClose = new WeakMap()

/** The window's page emptied of whatever an earlier mount left — the title the content set stays. */
function resetPage(doc) {
  const base = doc.createElement('base')
  base.href = document.baseURI
  const title = doc.title
  doc.head.replaceChildren(base)
  doc.title = title
}

/**
 * `children` drawn into `win`, a browser window this one opened (window.open,
 * in the click that asked for it, so it is not taken for an unasked popup).
 *
 * It stays part of this React tree — a portal — so it reads the same store and
 * the same contexts, and renders again on every write like everything else.
 * The window gets the app's stylesheets, kept in step with the ones this
 * document loads later (a lazy chunk's CSS, a hot update), and the root
 * element's attributes (the project colour); the title is the content's to
 * set. `onClose` is called once the user closes the window; unmounting closes
 * it from here, and leaving or reloading the app takes it along.
 */
export default function PopoutWindow({ win, onClose, children }) {
  // What the portal draws into — put into the window's page once it is set up.
  const root = useMemo(() => {
    const el = win.document.createElement('div')
    el.className = 'popout-root'
    return el
  }, [win])
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    clearTimeout(pendingClose.get(win))
    const doc = win.document
    resetPage(doc)

    // The stylesheets, copied and followed.
    const copies = new Map()
    const syncStyles = () => {
      const live = [...document.head.querySelectorAll('style, link[rel="stylesheet"]')]
      for (const [src, copy] of copies) {
        if (!live.includes(src)) { copy.remove(); copies.delete(src) }
      }
      for (const src of live) {
        const copy = copies.get(src)
        if (!copy) {
          const c = doc.importNode(src, true)
          if (src.href) c.href = src.href
          copies.set(src, c)
          doc.head.appendChild(c)
        } else if (src.tagName === 'STYLE' && copy.textContent !== src.textContent) {
          copy.textContent = src.textContent
        }
      }
    }
    const syncRootAttributes = () => {
      for (const { name, value } of document.documentElement.attributes) doc.documentElement.setAttribute(name, value)
    }
    syncStyles()
    syncRootAttributes()
    const styleWatch = new MutationObserver(syncStyles)
    styleWatch.observe(document.head, { childList: true, subtree: true, characterData: true })
    const rootWatch = new MutationObserver(syncRootAttributes)
    rootWatch.observe(document.documentElement, { attributes: true })

    doc.body.replaceChildren(root)

    // Closed by the user — noticed by the page going away (a reload of the
    // window takes the drawing with it too), and by asking, since not every
    // browser says so for a window without a page of its own.
    const gone = () => { if (win.closed) onCloseRef.current?.() }
    const onPageHide = () => setTimeout(() => onCloseRef.current?.())
    win.addEventListener('pagehide', onPageHide)
    const poll = setInterval(gone, 500)
    const closeWithApp = () => win.close()
    window.addEventListener('pagehide', closeWithApp)

    return () => {
      styleWatch.disconnect()
      rootWatch.disconnect()
      clearInterval(poll)
      win.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pagehide', closeWithApp)
      pendingClose.set(win, setTimeout(() => win.close()))
    }
  }, [win, root])

  return createPortal(children, root)
}
