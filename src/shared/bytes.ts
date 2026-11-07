/**
 * base64 / data URL 的来回转换。
 *
 * 为什么用 data URL 而不是 Blob 传字节：跨 world（页面 ↔ isolated world）与
 * chrome.runtime 消息都只可靠地运可 JSON 化的值，Blob 会被丢成 {}。
 */
import { ImportError } from "@/shared/errors"

export function arrayBufferToDataUrl(
  bytes: ArrayBuffer,
  contentType: string
): string {
  const view = new Uint8Array(bytes)
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < view.length; index += chunk) {
    binary += String.fromCharCode(...view.subarray(index, index + chunk))
  }
  return `data:${contentType || "application/octet-stream"};base64,${btoa(binary)}`
}

export function dataUrlToBlob(dataUrl: string): { blob: Blob; type: string } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!match) throw new ImportError("BAD_RESPONSE", "图片数据不是 data URL")
  const type = match[1] || "application/octet-stream"
  const isBase64 = Boolean(match[2])
  const payload = match[3]
  if (!isBase64) {
    return { blob: new Blob([decodeURIComponent(payload)], { type }), type }
  }
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return { blob: new Blob([bytes], { type }), type }
}
