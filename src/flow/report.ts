/**
 * 完成报告 —— 搬运结束后给人看的那几行，以及给 QA 的节流证据。
 * 图片失败逐条列、非图片附件列文件名与原链接、丢弃的导航宏给个数。
 */
export interface FailedImage {
  filename: string
  reason: string
  downloadUrl?: string
}

export interface ImportReport {
  title: string
  sourceUrl: string
  pageId: string
  pageUrl: string
  /** 写入的空间名（接口没给名字时为空串，报告里省略这一行）。 */
  spaceName: string
  conflict: "update" | "create_copy"
  images: {
    total: number
    uploaded: number
    failed: FailedImage[]
  }
  attachmentLinks: { filename: string; url: string }[]
  droppedMacros: string[]
  unknownMacros: string[]
  warnings: string[]
  queue: { count: number; minGapMs: number | null }
}

export function reportLines(report: ImportReport): string[] {
  const lines: string[] = []
  if (report.spaceName) lines.push(`已写入空间：${report.spaceName}`)
  const images = report.images
  lines.push(
    `图片 ${images.total} 张：转存 ${images.uploaded} 张` +
      (images.failed.length ? `，未转存 ${images.failed.length} 张` : "")
  )
  for (const failure of images.failed) {
    lines.push(`· 未转存：${failure.filename || "未命名"}（${failure.reason}）`)
  }
  if (report.attachmentLinks.length) {
    lines.push(`非图片附件 ${report.attachmentLinks.length} 个：只保留原链接`)
    for (const link of report.attachmentLinks) {
      lines.push(`· ${link.filename}`)
    }
  }
  if (report.droppedMacros.length) {
    lines.push(`已丢弃导航宏：${report.droppedMacros.join("、")}`)
  }
  if (report.unknownMacros.length) {
    lines.push(`未识别宏已展开正文：${report.unknownMacros.join("、")}`)
  }
  for (const warning of report.warnings) lines.push(`注意：${warning}`)
  lines.push(
    `对源站的请求 ${report.queue.count} 次，最短间隔 ${
      report.queue.minGapMs === null ? "—" : `${report.queue.minGapMs}ms`
    }`
  )
  lines.push(
    report.conflict === "update"
      ? "同名页面已更新为新版本（可在 ciki 版本历史回滚）"
      : "已另存为新页面"
  )
  return lines
}
