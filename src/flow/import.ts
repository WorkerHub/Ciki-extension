/**
 * 整页搬运的编排：解析基址 → 取正文 → 附件清单 → 确认 → 图片串行下载/上传 → 转换 → 建页。
 *
 * 分工：这里只做顺序与判定，不碰 DOM 之外的东西（转换器负责 DOM），
 * 网络请求全部经后台的 Confluence 队列或 ciki 导入接口。
 * 红线：图片逐张来（零并发）；遇到 429 / 登录失效立即整次停手，不重试。
 */

import {
  type QueueSnapshot,
  summarizeQueue
} from "@/background/confluence-queue"
import {
  cikiPageUrl,
  dataUrlToBlob,
  ImportApi,
  type ImportParent
} from "@/ciki/api"
import { indexAttachments, matchAttachment } from "@/confluence/attachments"
import type { Attachment, ConfluenceContent } from "@/confluence/client"
import {
  downloadImage,
  loadAttachments,
  loadContent
} from "@/confluence/client"
import { cleanConfluenceHtml } from "@/convert/cleaner"
import { isHostedImageSrc } from "@/convert/media"
import { htmlToTiptapDoc } from "@/convert/schema"
import {
  type ImageOutcome,
  type PreparedStorage,
  parseStorage,
  renderStorage
} from "@/convert/storage"
import { applyColWidthsFromColgroup } from "@/convert/table-columns"
import type { ImportReport } from "@/flow/report"
import {
  describeImportError,
  ImportError,
  toImportError
} from "@/shared/errors"
import { isAcceptedImageType, normalizeImageType } from "@/shared/image-type"
import type { PageProbe } from "@/shared/messages"
import { sendMessage } from "@/shared/messages"
import {
  baseCandidates,
  isConfigured,
  loadSettings,
  originOf,
  type Settings,
  saveSettings
} from "@/shared/settings"

/** ciki 的 contentJson 上限（契约：800,000 字节）。 */
export const MAX_CONTENT_JSON_BYTES = 800_000

export interface ImportJob {
  runId: string
  tabId: number
  probe: PageProbe
}

export interface ParentOption {
  id: string
  title: string
  parentId: string | null
  depth: number
}

export interface ConfirmInput {
  sourceTitle: string
  sourceUrl: string
  pageId: string
  parents: ParentOption[]
  defaultParentId: string | null
  conflict: { exists: boolean; pageId?: string }
}

export interface ImportContext {
  settings: Settings
  base: string
  content: ConfluenceContent
  attachments: ReturnType<typeof indexAttachments>
  prepared: PreparedStorage
  api: ImportApi
  pageId: string
  parents: ParentOption[]
  warnings: string[]
}

export interface ConfirmDecision {
  title: string
  parentId: string | null
  conflict: "update" | "create_copy"
}

export interface ProgressUpdate {
  step: string
  detail?: string
  current?: number
  total?: number
}

export interface ImportResult {
  pageId: string
  url: string
  report: ImportReport
}

function ensureConfigured(settings: Settings): void {
  if (!isConfigured(settings)) {
    throw new ImportError(
      "UNEXPECTED",
      "还没配置完整：源站地址、ciki 地址、导入令牌都要先在设置里填好",
      { hint: "点插件图标 →「设置」，三项填完并授权域名。" }
    )
  }
}

/** 父级树摘要拍平成下拉项（缩进用 depth）。 */
export function flattenParents(list: ImportParent[]): ParentOption[] {
  const byId = new Map(list.map((item) => [item.id, item]))
  return list.map((item) => {
    let depth = 0
    let cursor = item.parentId
    const seen = new Set<string>()
    while (cursor && byId.has(cursor) && !seen.has(cursor) && depth < 100) {
      seen.add(cursor)
      depth += 1
      cursor = byId.get(cursor)?.parentId ?? null
    }
    return { id: item.id, title: item.title, parentId: item.parentId, depth }
  })
}

/** 逐个候选基址试正文；把第一个成功的记住，下次直接用。 */
async function resolveBase(
  settings: Settings,
  contextPath: string,
  pageId: string
): Promise<{ base: string; content: ConfluenceContent }> {
  const candidates = baseCandidates(settings, contextPath)
  let lastError: ImportError | null = null
  for (const base of candidates) {
    try {
      const content = await loadContent(base, pageId)
      if (settings.confluenceBase !== base) {
        await saveSettings({ confluenceBase: base })
      }
      return { base, content }
    } catch (error) {
      const value = toImportError(error)
      // 登录失效 / 限流是红线错误：立刻停，不换基址接着闯
      if (value.stop) throw value
      lastError = value
    }
  }
  throw (
    lastError ??
    new ImportError("NOT_FOUND", "所有候选基址都拿不到这一页的正文")
  )
}

function defaultParentId(
  settings: Settings,
  parents: ParentOption[]
): string | null {
  if (!settings.defaultParentId) return null
  return parents.some((item) => item.id === settings.defaultParentId)
    ? settings.defaultParentId
    : null
}

export async function prepareImport(
  job: ImportJob
): Promise<{ context: ImportContext; confirm: ConfirmInput }> {
  const settings = await loadSettings()
  ensureConfigured(settings)
  if (originOf(settings.confluenceUrl) !== originOf(job.probe.pageUrl)) {
    throw new ImportError("UNEXPECTED", "当前页不属于设置里填的源站", {
      hint: `请在设置里把源站地址改成 ${originOf(job.probe.pageUrl)}，或回该站点的页面再剪藏。`
    })
  }

  const { base, content } = await resolveBase(
    settings,
    job.probe.contextPath,
    job.probe.pageId
  )

  const warnings: string[] = []
  let attachments: Attachment[] = []
  try {
    attachments = await loadAttachments(base, job.probe.pageId)
  } catch (error) {
    const value = toImportError(error)
    if (value.stop) throw value
    warnings.push(
      `附件清单没取到（${describeImportError(error)}），图片会全部按未转存处理`
    )
  }

  const prepared = parseStorage(content.storage)
  const api = new ImportApi(settings.cikiUrl, settings.importToken)
  const parents = flattenParents(await api.parents())
  const parentId = defaultParentId(settings, parents)
  const conflict = await api.check(content.title, parentId)

  return {
    context: {
      settings,
      base,
      content,
      attachments: indexAttachments(attachments),
      prepared,
      api,
      pageId: job.probe.pageId,
      parents,
      warnings
    },
    confirm: {
      sourceTitle: content.title,
      sourceUrl: content.selfUrl,
      pageId: job.probe.pageId,
      parents,
      defaultParentId: parentId,
      conflict
    }
  }
}

export async function checkConflict(
  context: ImportContext,
  title: string,
  parentId: string | null
): Promise<{ exists: boolean; pageId?: string }> {
  return context.api.check(title, parentId)
}

function cacheKey(filename: string): string {
  return filename.trim().toLowerCase()
}

async function uploadOne(
  context: ImportContext,
  attachment: Attachment
): Promise<ImageOutcome> {
  if (!attachment.downloadUrl) {
    return {
      status: "failed",
      filename: attachment.filename,
      reason: "附件没有下载链接"
    }
  }
  if (!attachment.uploadable) {
    return {
      status: "failed",
      filename: attachment.filename,
      downloadUrl: attachment.downloadUrl,
      reason: attachment.isImage
        ? "图片格式 ciki 不收（只收 png/jpg/gif/webp）"
        : "不是图片附件，不转存"
    }
  }
  try {
    const downloaded = await downloadImage(attachment.downloadUrl)
    const { blob } = dataUrlToBlob(downloaded.dataUrl)
    // 反代有时回 application/octet-stream：按附件元数据/文件名补上 ciki 认的类型，
    // 否则上传被拒、图白抓一场。
    const contentType = isAcceptedImageType(blob.type)
      ? blob.type
      : normalizeImageType(attachment.mediaType, attachment.filename) ||
        blob.type
    const uploadBlob =
      contentType && contentType !== blob.type
        ? new Blob([blob], { type: contentType })
        : blob
    const uploaded = await context.api.upload(uploadBlob, attachment.filename)
    if (!isHostedImageSrc(uploaded.url)) {
      return {
        status: "failed",
        filename: attachment.filename,
        downloadUrl: attachment.downloadUrl,
        reason: "ciki 返回的图床地址不符合契约（/api/files/…）"
      }
    }
    return {
      status: "uploaded",
      url: uploaded.url,
      filename: attachment.filename,
      downloadUrl: attachment.downloadUrl
    }
  } catch (error) {
    const value = toImportError(error)
    // 429 / 登录失效：整次搬运停手，不留半套内容
    if (value.stop) throw value
    return {
      status: "failed",
      filename: attachment.filename,
      downloadUrl: attachment.downloadUrl,
      reason: describeImportError(error)
    }
  }
}

async function runImagePipeline(
  context: ImportContext,
  onProgress: (update: ProgressUpdate) => void
): Promise<Map<number, ImageOutcome>> {
  const outcomes = new Map<number, ImageOutcome>()
  const cache = new Map<string, ImageOutcome>()
  const refs = context.prepared.refs
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]
    onProgress({
      step: "图片",
      detail: ref.filename || `第 ${index + 1} 张`,
      current: index + 1,
      total: refs.length
    })
    if (ref.kind === "external") {
      outcomes.set(ref.index, {
        status: "external",
        filename: ref.filename,
        reason: "外链图片保留原地址"
      })
      continue
    }
    const key = cacheKey(ref.filename)
    const cached = key ? cache.get(key) : undefined
    if (cached) {
      outcomes.set(ref.index, cached)
      continue
    }
    const attachment = matchAttachment(context.attachments, ref)
    const outcome = attachment
      ? await uploadOne(context, attachment)
      : {
          status: "failed" as const,
          filename: ref.filename,
          reason:
            ref.kind === "drawio"
              ? "drawio 图没有配套的附件"
              : "附件清单里没有这个文件"
        }
    if (key) cache.set(key, outcome)
    outcomes.set(ref.index, outcome)
  }
  return outcomes
}

export async function executeImport(
  context: ImportContext,
  decision: ConfirmDecision,
  onProgress: (update: ProgressUpdate) => void
): Promise<ImportResult> {
  onProgress({ step: "读取图片", detail: "逐张下载并上传" })
  const outcomes = await runImagePipeline(context, onProgress)

  onProgress({ step: "转换正文" })
  const rendered = renderStorage(context.prepared, outcomes, {
    base: context.base,
    attachmentUrls: context.attachments.downloadUrls
  })
  const cleaned = applyColWidthsFromColgroup(cleanConfluenceHtml(rendered.html))
  const contentJson = JSON.stringify(htmlToTiptapDoc(cleaned))
  const bytes = new TextEncoder().encode(contentJson).length
  if (bytes > MAX_CONTENT_JSON_BYTES) {
    throw new ImportError(
      "PAYLOAD_TOO_LARGE",
      `转换后的正文 ${bytes} 字节，超过 ciki 的 ${MAX_CONTENT_JSON_BYTES} 字节上限`
    )
  }

  onProgress({ step: "写入 ciki" })
  const created = await context.api.createPage({
    title: decision.title,
    parentId: decision.parentId,
    contentJson,
    conflict: decision.conflict
  })

  const pageUrl = cikiPageUrl(
    context.settings.cikiUrl,
    created.url,
    created.pageId
  )

  const parentTitle =
    context.parents.find((item) => item.id === decision.parentId)?.title ?? ""
  await saveSettings({
    defaultParentId: decision.parentId,
    defaultParentTitle: parentTitle
  })

  const statsReply = await sendMessage<{
    snapshot: QueueSnapshot
  }>({ type: "queue:stats" })
  const queue = summarizeQueue(
    statsReply.ok
      ? statsReply.data.snapshot
      : { lastStartedAt: null, records: [] }
  )

  const uploaded = [...outcomes.values()].filter(
    (outcome) => outcome.status === "uploaded"
  ).length
  const failed = [...outcomes.values()]
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => ({
      filename: outcome.filename || "未命名",
      reason: outcome.reason || "未转存",
      downloadUrl: outcome.downloadUrl
    }))
  const external = [...outcomes.values()].filter(
    (outcome) => outcome.status === "external"
  ).length

  const report: ImportReport = {
    title: decision.title,
    sourceUrl: context.content.selfUrl,
    pageId: created.pageId,
    pageUrl,
    conflict: decision.conflict,
    images: {
      total: context.prepared.refs.length,
      uploaded,
      external,
      failed
    },
    attachmentLinks: rendered.attachmentLinks,
    droppedMacros: rendered.droppedMacros,
    unknownMacros: rendered.unknownMacros,
    warnings: context.warnings,
    queue
  }

  return { pageId: created.pageId, url: pageUrl, report }
}
