import { FetchSource } from 'pmtiles'

/**
 * The kilometrage archive's byte source: pmtiles' own, but a refused answer
 * is asked for once more past the browser cache.
 *
 * The browser keeps the parts of the archive it has fetched. Once the archive
 * on the server is a new file — every deploy writes it anew, and its ETag
 * changes with it — the browser asks for a range with `If-Range` and the old
 * ETag, and the server rightly answers with the whole 48 MB file instead of
 * the range. pmtiles takes that for a server without range requests and gives
 * up, and the overlay said its tiles were missing. From the first refusal on,
 * every request goes to the server (`mustReload`, pmtiles' own switch).
 */
export class KmTileSource extends FetchSource {
  async getBytes(offset, length, signal, etag) {
    try {
      return await super.getBytes(offset, length, signal, etag)
    } catch (err) {
      if (signal?.aborted || this.mustReload) throw err
      this.mustReload = true
      return super.getBytes(offset, length, signal, etag)
    }
  }
}
