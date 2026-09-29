/** Longest side a stored logo keeps [px] — a print of a few cm needs no more. */
const MAX_PX = 600

/**
 * Read an image file into a PNG data URL of bounded size, with its pixel size.
 * Going through a canvas makes every format the browser can show (SVG, JPEG,
 * WebP …) the one thing the PDF backend takes, and keeps the store small.
 */
export function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const nw = img.naturalWidth || img.width || MAX_PX
      const nh = img.naturalHeight || img.height || MAX_PX
      const k = Math.min(1, MAX_PX / Math.max(nw, nh))
      const w = Math.max(1, Math.round(nw * k))
      const h = Math.max(1, Math.round(nh * k))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ dataUrl: canvas.toDataURL('image/png'), w, h })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image'))
    }
    img.src = url
  })
}
