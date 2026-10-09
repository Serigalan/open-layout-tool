import { useRef } from 'react'

/**
 * A button that opens the file chooser (R5.1) — the hidden input it needs is
 * its own. `onFile` gets the chosen file; the input is cleared afterwards, so
 * choosing the same file again reads it again.
 */
export default function FilePickButton({ accept, onFile, disabled, className = 'panel-btn panel-btn-full', title, children }) {
  const inputRef = useRef(null)
  return (
    <>
      <input hidden ref={inputRef} type="file" accept={accept} onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) onFile(file)
      }} />
      <button className={className} disabled={disabled} title={title} onClick={() => inputRef.current?.click()}>
        {children}
      </button>
    </>
  )
}
