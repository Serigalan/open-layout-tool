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

/** A picture of the list as { mime, data } for api.uploadImage. */
export async function projectImagePicture(image) {
  const res = await fetch(projectImageUrl(image))
  if (!res.ok) throw Object.assign(new Error('image_missing'), { code: 'image_missing' })
  return { mime: PROJECT_IMAGE_MIME, data: textToBase64(await res.text()) }
}
