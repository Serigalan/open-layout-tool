/**
 * Messages under a form (R5.1): one paragraph each, `kind` error, warn or ok.
 * Nothing at all when there are none.
 */
export default function MessageList({ items, kind = 'error', className = 'mt-6', small = true }) {
  if (!items?.length) return null
  return (
    <div className={className}>
      {items.map((text, i) => (
        <p key={i} className={`msg-${kind}${small ? ' msg-small' : ''}`}>{text}</p>
      ))}
    </div>
  )
}
