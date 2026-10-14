// The splice off the main thread (decision 294): most answers take a
// millisecond, but searching the largest radius that keeps a spacing builds
// the splice over and over and takes a second or two — the page would stand
// still for it.
import { solveSplice } from './solveSplice'

self.onmessage = (e) => {
  const { id, request } = e.data
  try {
    self.postMessage({ id, ok: true, answer: solveSplice(request) })
  } catch (err) {
    self.postMessage({ id, ok: false, message: err?.message ?? String(err) })
  }
}
