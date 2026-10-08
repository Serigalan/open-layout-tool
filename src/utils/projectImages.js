/**
 * The pictures a new project can start with instead of a file of its own:
 * country outlines and pictograms, white on the app's primary colour, each a
 * 240 × 180 SVG under `public/project-images/` (4:3, like the slot on the start
 * page, so `object-fit: cover` crops nothing).
 *
 * A chosen picture is uploaded like any other — the record names it by the
 * hash the server keeps it under — so a project does not depend on this list
 * staying as it is.
 *
 * Countries: Natural Earth 1:50m (public domain). Pictograms: Font Awesome
 * Free 7.3.1 (CC BY 4.0); the credit is in every file and under the picker.
 */
export const PROJECT_IMAGES = [
  'de', 'at', 'fr', 'be', 'ch',
  'fernbahn', 'tram', 'ubahn', 'gueter',
  'bahnhof', 'abstellung', 'anschluss', 'hafen', 'flughafen', 'bruecke', 'tunnel', 'bue',
  'neubau', 'umbau', 'elektrifizierung', 'studie',
].map(key => ({ key, labelKey: `project_image_${key}`, file: `${key}.svg` }))

const PROJECT_IMAGE_MIME = 'image/svg+xml'

/** Where the app serves a picture from — relative, like every asset (`base: './'`). */
export const projectImageUrl = (image) => `./project-images/${image.file}`

/** UTF-8 text as base64, for the upload's `data`. */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Width of an own picture at most [px] — the slot on the start page is far smaller. */
const OWN_MAX_W = 960

/**
 * The canvas an own picture of nw × nh px is fitted into: 4:3 like the slot,
 * the picture whole and centred, the rest left to the white margin. Keeps the
 * picture's resolution up to OWN_MAX_W.
 */
export function fitToSlot(nw, nh, maxW = OWN_MAX_W) {
  const w0 = Math.max(nw, nh * 4 / 3)
  const k = Math.min(1, maxW / w0)
  const w = Math.max(4, Math.round(w0 * k))
  const h = Math.round(w * 3 / 4)
  const dw = Math.min(w, Math.round(nw * k))
  const dh = Math.min(h, Math.round(nh * k))
  return { w, h, x: Math.round((w - dw) / 2), y: Math.round((h - dh) / 2), dw, dh }
}

/**
 * A chosen file as a data URL fitted to the slot (fitToSlot) on white, or null
 * when the browser cannot read it as a picture. A JPEG stays a JPEG, anything
 * else becomes a PNG.
 */
export function fileToProjectImage(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const nw = img.naturalWidth || img.width
      const nh = img.naturalHeight || img.height
      if (!nw || !nh) return resolve(null)
      const { w, h, x, y, dw, dh } = fitToSlot(nw, nh)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, x, y, dw, dh)
      resolve(file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** A picture of the list as { mime, data } for api.uploadImage. */
export async function projectImagePicture(image) {
  const res = await fetch(projectImageUrl(image))
  if (!res.ok) throw Object.assign(new Error('image_missing'), { code: 'image_missing' })
  return { mime: PROJECT_IMAGE_MIME, data: textToBase64(await res.text()) }
}
