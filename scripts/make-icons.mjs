/**
 * 生成开发者模式用的占位图标（16/48/128）。
 * 只依赖 node 内置 zlib：不为了三张小图引入图形库。
 * 图案：深靛蓝底 + 白色「页角」折角块 —— 一眼能认出来是插件，不追求设计感。
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"

const BG = [0x35, 0x3c, 0xa8]
const FG = [0xff, 0xff, 0xff]

function crc32(buffer) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function pixel(size, x, y) {
  const inset = Math.round(size * 0.22)
  const inner = size - inset * 2
  const fold = Math.round(size * 0.3)
  const inPage =
    x >= inset && x < inset + inner && y >= inset && y < inset + inner
  if (!inPage) return BG
  // 右上角折角留空，其余是白纸
  const cornerX = x - (size - inset - fold)
  const cornerY = y - inset
  const inFold = cornerX >= 0 && cornerY >= 0 && cornerX + cornerY < fold
  if (inFold) return BG
  // 两行「文字」条，读起来像一页文档
  const lineX = x - inset - Math.round(size * 0.1)
  const lineW = inner - Math.round(size * 0.2)
  const line1 = Math.round(size * 0.5)
  const line2 = Math.round(size * 0.66)
  const thick = Math.max(1, Math.round(size * 0.06))
  if (lineX >= 0 && lineX < lineW) {
    if (y >= line1 && y < line1 + thick) return [0xc7, 0xd2, 0xfe]
    if (y >= line2 && y < line2 + thick) return [0xc7, 0xd2, 0xfe]
  }
  return FG
}

function encode(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(size, x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ])
}

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true })
for (const size of [16, 48, 128]) {
  const file = new URL(`../public/icons/icon-${size}.png`, import.meta.url)
  writeFileSync(file, encode(size))
  console.log(`icons/icon-${size}.png`)
}
