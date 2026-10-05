/**
 * A small QR code encoder, with no dependencies. It turns a short text (a join link) into the
 * grid of dark and light squares that `QrCode` in the kit draws.
 *
 * Scope, on purpose: byte mode, error correction level M (about 15% of the code can be damaged or
 * covered and it still scans), versions 1 to 10. That holds up to 213 bytes, far more than a link
 * needs. Longer text throws.
 *
 * It follows ISO/IEC 18004. The structure mirrors the well-known reference implementation by
 * Project Nayuki (MIT licence). tests/qr-encode.test.ts checks known-answer vectors.
 */

/** Error correction codewords per block, level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
/** Number of error correction blocks, level M, by version. */
const BLOCK_COUNT = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const MAX_VERSION = 10
/** The two format bits that mean "level M". */
const FORMAT_BITS_M = 0

export type QrMatrix = {
  /** Squares per side. */
  size: number
  version: number
  /** modules[y][x] is true for a dark square. */
  modules: boolean[][]
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2
    result -= (25 * alignCount - 10) * alignCount - 55
    if (version >= 7) result -= 36
  }
  return result
}

/** Data codewords (bytes) a version holds at level M. */
function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCK_COUNT[version]
}

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor)
    })
  }
  return result
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const size = version * 4 + 17
  const result = [6]
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position)
  return result
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** The standard's score for how hard a pattern is to scan. Lower is better. */
function penalty(modules: boolean[][]): number {
  const size = modules.length
  let result = 0

  const finderLike = (line: boolean[]) => {
    // 1:1:3:1:1 dark runs with four light squares on either side.
    let count = 0
    for (let i = 0; i + 10 < line.length; i++) {
      const a = [true, false, true, true, true, false, true, false, false, false, false]
      const b = [false, false, false, false, true, false, true, true, true, false, true]
      if (a.every((value, k) => line[i + k] === value) || b.every((value, k) => line[i + k] === value)) count++
    }
    return count
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      const line: boolean[] = []
      for (let b = 0; b < size; b++) line.push(pass === 0 ? modules[a][b] : modules[b][a])
      let run = 1
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++
        else {
          if (run >= 5) result += 3 + (run - 5)
          run = 1
        }
      }
      result += finderLike(line) * 40
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x]
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) result += 3
    }
  }

  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return result
}

/** UTF-8 bytes of a string, without TextEncoder so it also runs in the plain test runner. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return bytes
}

/** Encodes `text` as a QR code. Throws when the text is longer than a version 10 code holds (213 bytes). */
export function encodeQr(text: string): QrMatrix {
  const bytes = utf8Bytes(text)

  let version = 1
  for (; ; version++) {
    if (version > MAX_VERSION) throw new Error("This text is too long for a QR code.")
    const countBits = version < 10 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break
  }

  // 1. The bit stream: mode, length, the bytes, terminator, padding.
  const capacityBits = dataCodewords(version) * 8
  const bits: number[] = []
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  append(0b0100, 4)
  append(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) append(byte, 8)
  append(0, Math.min(4, capacityBits - bits.length))
  append(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k]
    data.push(byte)
  }

  // 2. Error correction, split into blocks and interleaved.
  const blockCount = BLOCK_COUNT[version]
  const eccLength = ECC_PER_BLOCK[version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blockCount - (rawCodewords % blockCount)
  const shortBlockLength = Math.floor(rawCodewords / blockCount)
  const divisor = reedSolomonDivisor(eccLength)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, k + shortBlockLength - eccLength + (i < shortBlocks ? 0 : 1))
    k += block.length
    const ecc = reedSolomonRemainder(block, divisor)
    if (i < shortBlocks) block.push(0)
    blocks.push(block.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // The padding slot of a short block is skipped.
      if (i !== shortBlockLength - eccLength || j >= shortBlocks) codewords.push(block[i])
    })
  }

  // 3. The grid: fixed patterns first, then the data in a zigzag.
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFunction[y][x] = true
  }

  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, distance !== 2 && distance !== 4)
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)

  const align = alignmentPositions(version)
  align.forEach((cx, i) => {
    align.forEach((cy, j) => {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)
      if (onFinder) return
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    })
  })

  const drawFormat = (mask: number) => {
    const value = (FORMAT_BITS_M << 3) | mask
    let remainder = value
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
    const format = ((value << 10) | remainder) ^ 0x5412
    const bit = (i: number) => ((format >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i))
    setFunction(8, 7, bit(6))
    setFunction(8, 8, bit(7))
    setFunction(7, 8, bit(8))
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i))
    setFunction(8, size - 8, true)
  }
  drawFormat(0)

  if (version >= 7) {
    let remainder = version
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
    const info = (version << 12) | remainder
    for (let i = 0; i < 18; i++) {
      const dark = ((info >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(a, b, dark)
      setFunction(b, a, dark)
    }
  }

  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0
          bitIndex++
        }
      }
    }
  }

  // 4. Try the eight masks and keep the one that scans best.
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x]
      }
    }
  }
  let bestMask = 0
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const score = penalty(modules)
    if (score < bestPenalty) {
      bestPenalty = score
      bestMask = mask
    }
    applyMask(mask)
  }
  applyMask(bestMask)
  drawFormat(bestMask)

  return { size, version, modules }
}
