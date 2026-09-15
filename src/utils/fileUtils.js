/** Hand a blob to the browser as a download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJSON(data, filename) {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  downloadBlob(new Blob([content], { type: 'application/json' }), filename)
}

/** Download a text file — an SVG sheet, say. */
export function downloadText(text, filename, type = 'text/plain') {
  downloadBlob(new Blob([text], { type }), filename)
}
