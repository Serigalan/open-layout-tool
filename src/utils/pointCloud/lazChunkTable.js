/**
 * The chunk table of a LAZ file: where each block of points starts and how
 * many points it holds. LASzip compresses points in independent chunks
 * (usually 50 000 points), and the table at the end of the file is what lets a
 * reader walk them one at a time — `File.slice` a chunk, decode it, drop it —
 * instead of holding a file of several gigabytes (Entscheidung 120).
 *
 * laz-perf decodes a chunk (`ChunkDecoder`) but does not expose the table,
 * which LASzip writes arithmetic-coded. So the table's decoder is ported here
 * from LASzip (arithmeticdecoder.cpp, arithmeticmodel.cpp,
 * integercompressor.cpp) — just the part that reads it: an integer compressor
 * of 32 bits with two contexts, one for point counts, one for byte counts.
 *
 * All arithmetic is unsigned 32-bit as in the C++; the products stay below
 * 2^32 and are kept exact as doubles, `>>> 0` brings shifts back to uint32.
 */

const AC_MIN_LENGTH = 0x01000000
const AC_MAX_LENGTH = 0xFFFFFFFF
const BM_LENGTH_SHIFT = 13
const BM_MAX_COUNT = 1 << BM_LENGTH_SHIFT
const DM_LENGTH_SHIFT = 15
const DM_MAX_COUNT = 1 << DM_LENGTH_SHIFT

class BitModel {
  constructor() {
    this.bit0Count = 1
    this.bitCount = 2
    this.bit0Prob = 1 << (BM_LENGTH_SHIFT - 1)
    this.updateCycle = this.bitsUntilUpdate = 4
  }

  update() {
    if ((this.bitCount += this.updateCycle) > BM_MAX_COUNT) {
      this.bitCount = (this.bitCount + 1) >>> 1
      this.bit0Count = (this.bit0Count + 1) >>> 1
      if (this.bit0Count === this.bitCount) ++this.bitCount
    }
    const scale = Math.floor(0x80000000 / this.bitCount)
    this.bit0Prob = Math.floor(this.bit0Count * scale / 2 ** (31 - BM_LENGTH_SHIFT))
    this.updateCycle = Math.min((5 * this.updateCycle) >>> 2, 64)
    this.bitsUntilUpdate = this.updateCycle
  }
}

class SymbolModel {
  constructor(symbols) {
    this.symbols = symbols
    this.lastSymbol = symbols - 1
    if (symbols > 16) {
      let tableBits = 3
      while (symbols > (1 << (tableBits + 2))) ++tableBits
      this.tableSize = 1 << tableBits
      this.tableShift = DM_LENGTH_SHIFT - tableBits
      this.decoderTable = new Uint32Array(this.tableSize + 2)
    } else {
      this.tableSize = this.tableShift = 0
      this.decoderTable = null
    }
    this.distribution = new Uint32Array(symbols)
    this.symbolCount = new Uint32Array(symbols).fill(1)
    this.totalCount = 0
    this.updateCycle = symbols
    this.update()
    this.symbolsUntilUpdate = this.updateCycle = (symbols + 6) >>> 1
  }

  update() {
    const { symbols, symbolCount, distribution, decoderTable } = this
    if ((this.totalCount += this.updateCycle) > DM_MAX_COUNT) {
      this.totalCount = 0
      for (let n = 0; n < symbols; n++) this.totalCount += (symbolCount[n] = (symbolCount[n] + 1) >>> 1)
    }
    const scale = Math.floor(0x80000000 / this.totalCount)
    let sum = 0, s = 0
    for (let k = 0; k < symbols; k++) {
      distribution[k] = Math.floor(scale * sum / 2 ** (31 - DM_LENGTH_SHIFT))
      sum += symbolCount[k]
      if (decoderTable) {
        const w = distribution[k] >>> this.tableShift
        while (s < w) decoderTable[++s] = k - 1
      }
    }
    if (decoderTable) {
      decoderTable[0] = 0
      while (s <= this.tableSize) decoderTable[++s] = symbols - 1
    }
    this.updateCycle = Math.min((5 * this.updateCycle) >>> 2, (symbols + 6) << 3)
    this.symbolsUntilUpdate = this.updateCycle
  }
}

export class ArithmeticDecoder {
  constructor(bytes, at = 0) {
    this.bytes = bytes
    this.at = at
    this.length = AC_MAX_LENGTH
    this.value = 0
    for (let i = 0; i < 4; i++) this.value = this.value * 256 + this.byte()
  }

  byte() {
    if (this.at >= this.bytes.length) throw new Error('LAZ chunk table cut short')
    return this.bytes[this.at++]
  }

  renorm() {
    do {
      this.value = (this.value * 256 + this.byte()) >>> 0
      this.length = (this.length * 256) >>> 0
    } while (this.length < AC_MIN_LENGTH)
  }

  decodeBit(m) {
    const x = m.bit0Prob * (this.length >>> BM_LENGTH_SHIFT)
    let sym
    if (this.value < x) {
      sym = 0
      this.length = x
      ++m.bit0Count
    } else {
      sym = 1
      this.value -= x
      this.length -= x
    }
    if (this.length < AC_MIN_LENGTH) this.renorm()
    if (--m.bitsUntilUpdate === 0) m.update()
    return sym
  }

  decodeSymbol(m) {
    let n, sym, x, y = this.length
    if (m.decoderTable) {
      this.length = this.length >>> DM_LENGTH_SHIFT
      const dv = Math.floor(this.value / this.length)
      const t = dv >>> m.tableShift
      sym = m.decoderTable[t]
      n = m.decoderTable[t + 1] + 1
      while (n > sym + 1) {
        const k = (sym + n) >>> 1
        if (m.distribution[k] > dv) n = k; else sym = k
      }
      x = m.distribution[sym] * this.length
      if (sym !== m.lastSymbol) y = m.distribution[sym + 1] * this.length
    } else {
      x = sym = 0
      this.length = this.length >>> DM_LENGTH_SHIFT
      n = m.symbols
      let k = n >>> 1
      do {
        const z = this.length * m.distribution[k]
        if (z > this.value) { n = k; y = z } else { sym = k; x = z }
      } while ((k = (sym + n) >>> 1) !== sym)
    }
    this.value -= x
    this.length = y - x
    if (this.length < AC_MIN_LENGTH) this.renorm()
    ++m.symbolCount[sym]
    if (--m.symbolsUntilUpdate === 0) m.update()
    return sym
  }

  readBits(bits) {
    if (bits > 19) {
      const lower = this.readShort()
      const upper = this.readBits(bits - 16)
      return upper * 65536 + lower
    }
    this.length = this.length >>> bits
    const sym = Math.floor(this.value / this.length)
    this.value -= this.length * sym
    if (this.length < AC_MIN_LENGTH) this.renorm()
    return sym
  }

  readShort() {
    this.length = this.length >>> 16
    const sym = Math.floor(this.value / this.length)
    this.value -= this.length * sym
    if (this.length < AC_MIN_LENGTH) this.renorm()
    return sym
  }
}

/**
 * LASzip's IntegerCompressor, decompressing side, for 32-bit values (no
 * corrector range: the result wraps as a signed 32-bit integer).
 */
export class IntegerDecompressor {
  constructor(dec, contexts, bitsHigh = 8) {
    this.dec = dec
    this.bitsHigh = bitsHigh
    this.corrBits = 32
    this.corrMin = -0x80000000
    this.mBits = Array.from({ length: contexts }, () => new SymbolModel(this.corrBits + 1))
    this.mCorrector = [new BitModel()]
    for (let i = 1; i <= this.corrBits; i++) {
      this.mCorrector.push(new SymbolModel(i <= bitsHigh ? 2 ** i : 2 ** bitsHigh))
    }
  }

  decompress(pred, context) {
    return (pred + this.readCorrector(this.mBits[context])) | 0
  }

  readCorrector(mBits) {
    const k = this.dec.decodeSymbol(mBits)
    if (k === 0) return this.dec.decodeBit(this.mCorrector[0])
    if (k >= 32) return this.corrMin
    let c
    if (k <= this.bitsHigh) {
      c = this.dec.decodeSymbol(this.mCorrector[k])
    } else {
      const k1 = k - this.bitsHigh
      c = this.dec.decodeSymbol(this.mCorrector[k]) * 2 ** k1 + this.dec.readBits(k1)
    }
    return c >= 2 ** (k - 1) ? c + 1 : c - (2 ** k - 1)
  }
}

/**
 * The chunks of a LAZ file, from the bytes of its chunk table (`bytes`, which
 * start with the table's 8-byte head: version and chunk count). Returns one
 * `{ points, bytes }` per chunk — points null where every chunk holds
 * `chunkSize` (the last one may hold fewer; the caller knows the total).
 */
export function decodeChunkTable(bytes, chunkSize) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0, true)
  const count = view.getUint32(4, true)
  if (version !== 0) throw new Error(`LAZ chunk table version ${version} is not supported`)
  if (!count) return []
  const dec = new ArithmeticDecoder(bytes, 8)
  const ic = new IntegerDecompressor(dec, 2)
  const variable = chunkSize === 0xFFFFFFFF
  const chunks = []
  let points = 0, size = 0
  for (let i = 0; i < count; i++) {
    if (variable) points = ic.decompress(i ? points : 0, 0)
    size = ic.decompress(i ? size : 0, 1)
    chunks.push({ points: variable ? points : null, bytes: size })
  }
  return chunks
}
