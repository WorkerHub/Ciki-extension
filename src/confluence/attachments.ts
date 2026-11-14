/**
 * 附件清单的索引与匹配 —— 正文里的图片引用只带文件名，要靠这里对到下载链。
 *
 * drawio 宏没有附件名，惯例是「图名.png」；这里给出一组确定性的候选名，
 * 不命中就按不带扩展名的主名再比一次，仍未命中就按「抓不到」处理。
 */
import type { Attachment } from "@/confluence/client"
import type { ImageRef } from "@/convert/storage"

export interface AttachmentIndex {
  list: Attachment[]
  byFilename: Map<string, Attachment>
  byBasename: Map<string, Attachment>
  downloadUrls: Record<string, string>
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").toLowerCase()
}

export function indexAttachments(list: Attachment[]): AttachmentIndex {
  const byFilename = new Map<string, Attachment>()
  const byBasename = new Map<string, Attachment>()
  const downloadUrls: Record<string, string> = {}
  for (const attachment of list) {
    byFilename.set(attachment.filename.toLowerCase(), attachment)
    if (!byBasename.has(baseName(attachment.filename))) {
      byBasename.set(baseName(attachment.filename), attachment)
    }
    if (attachment.downloadUrl) {
      downloadUrls[attachment.filename] = attachment.downloadUrl
    }
  }
  return { list, byFilename, byBasename, downloadUrls }
}

export const EMPTY_INDEX: AttachmentIndex = indexAttachments([])

export function drawioCandidates(name: string): string[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  return [
    trimmed,
    `${trimmed}.png`,
    `${trimmed}.drawio.png`,
    `${trimmed}.drawio`
  ]
}

export function matchAttachment(
  index: AttachmentIndex,
  ref: ImageRef
): Attachment | null {
  if (ref.kind === "drawio") {
    for (const candidate of drawioCandidates(ref.filename)) {
      const hit = index.byFilename.get(candidate.toLowerCase())
      if (hit) return hit
    }
    return index.byBasename.get(ref.filename.trim().toLowerCase()) ?? null
  }
  const byName = index.byFilename.get(ref.filename.trim().toLowerCase())
  if (byName) return byName
  return index.byBasename.get(baseName(ref.filename)) ?? null
}
