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
  type ImportParent,
  type ImportSpace
} from "@/ciki/api"
import { indexAttachments, matchAttachment } from "@/confluence/attachments"
import type {
  Attachment,
  ConfluenceContent,
  DownloadedImage
} from "@/confluence/client"
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
  type ImageRef,
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
  isSameOrigin,
  loadSettings,
  originOf,
  permissionPattern,
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
  /** 令牌可写入的空间，默认空间在前（接口不给 isDefault 标记）。 */
  spaces: ImportSpace[]
  defaultSpaceId: string
  parents: ParentOption[]
  defaultParentId: string | null
  conflict: { exists: boolean; pageId?: string }
  /** 正文里的站外图：确认小窗据此按需申请站外域名的可选权限。 */
  externalImages: { count: number; patterns: string[]; hosts: string[] }
}

export interface ImportContext {
  settings: Settings
  base: string
  content: ConfluenceContent
  attachments: ReturnType<typeof indexAttachments>
  prepared: PreparedStorage
  api: ImportApi
  pageId: string
  spaces: ImportSpace[]
  parents: ParentOption[]
  warnings: string[]
}

export interface ConfirmDecision {
  title: string
  /** 写入落点；由弹窗里的空间下拉决定，显式传给写接口。 */
  spaceId: string
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

/**
 * 预选哪个空间：上次用过的还在列表里就用它（空间被删 / 权限被收回时回退），
 * 否则用列表第一项——接口保证默认空间在前。
 */
export function chooseSpaceId(
  remembered: string,
  spaces: ImportSpace[]
): string {
  const id = remembered.trim()
  if (id && spaces.some((space) => space.id === id)) return id
  return spaces[0]?.id ?? ""
}

/**
 * 站外图要用的域名权限：只挑第三方 origin，按 origin 去重。
 * 与源站 / ciki 同源的图走的是已有的会话链路，不需要额外授权，也不计入这个张数。
 */
function externalImageAccess(
  settings: Settings,
  refs: ImageRef[]
): ConfirmInput["externalImages"] {
  const patterns: string[] = []
  const hosts: string[] = []
  let count = 0
  for (const ref of refs) {
    if (ref.kind !== "external") continue
    const url = (ref.url ?? "").trim()
    if (!/^https?:\/\//i.test(url)) continue
    if (
      isSameOrigin(url, settings.confluenceUrl) ||
      isSameOrigin(url, settings.cikiUrl)
    ) {
      continue
    }
    count += 1
    const pattern = permissionPattern(url)
    if (!pattern || patterns.includes(pattern)) continue
    patterns.push(pattern)
    try {
      // 同一个域名可能既有 http 又有 https：授权 pattern 分两条，展示只写一次
      const host = new URL(url).host
      if (!hosts.includes(host)) hosts.push(host)
    } catch {
      // permissionPattern 已校验过地址，这里不会失败
    }
  }
  return { count, patterns, hosts }
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
  const spaces = await api.spaces()
  if (spaces.length === 0) {
    throw new ImportError(
      "SPACE_FORBIDDEN",
      "导入令牌所属用户在 ciki 里没有可写入的空间",
      {
        title: "没有可写入的空间",
        hint: "你在 ciki 里还没有 editor 及以上权限的空间；让空间管理员给你加权限后再剪藏。"
      }
    )
  }
  const spaceId = chooseSpaceId(settings.defaultSpaceId, spaces)
  const parents = flattenParents(await api.parents(spaceId))
  const parentId = defaultParentId(settings, parents)
  const conflict = await api.check(content.title, parentId, spaceId)

  return {
    context: {
      settings,
      base,
      content,
      attachments: indexAttachments(attachments),
      prepared,
      api,
      pageId: job.probe.pageId,
      spaces,
      parents,
      warnings
    },
    confirm: {
      sourceTitle: content.title,
      sourceUrl: content.selfUrl,
      pageId: job.probe.pageId,
      spaces,
      defaultSpaceId: spaceId,
      parents,
      defaultParentId: parentId,
      conflict,
      externalImages: externalImageAccess(settings, prepared.refs)
    }
  }
}

/**
 * 切到另一个空间：父级树跟着重新拉，父级回到记住的那一项
 * （记住的父级不在新空间时落顶层）。失败时调用方保持原空间，不动上下文。
 */
export async function selectSpace(
  context: ImportContext,
  spaceId: string
): Promise<{ parents: ParentOption[]; parentId: string | null }> {
  const parents = flattenParents(await context.api.parents(spaceId))
  context.parents = parents
  return { parents, parentId: defaultParentId(context.settings, parents) }
}

export async function checkConflict(
  context: ImportContext,
  spaceId: string,
  title: string,
  parentId: string | null
): Promise<{ exists: boolean; pageId?: string }> {
  return context.api.check(title, parentId, spaceId)
}

/** 一张图的下载地址与文件名；失败时正文里保留的原地址也是这个 url。 */
interface ImageSource {
  url: string
  filename: string
  /** 序号：URL 末段没有可用文件名时用 `external-<n>.<ext>` 兜底。 */
  index: number
  /** 仅附件：清单里的 mediaType，响应头给不出类型时的兜底。 */
  mediaType?: string
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
}

/** 上传用的文件名：URL 末段优先，没有可用扩展名时按 contentType 补一个。 */
function uploadFilename(
  source: ImageSource,
  downloaded: DownloadedImage,
  contentType: string
): string {
  const raw = (source.filename || downloaded.filename).trim()
  if (/\.[a-z0-9]{1,5}$/i.test(raw)) return raw
  const extension = EXTENSION_BY_TYPE[contentType] ?? "png"
  return `${raw || `external-${source.index + 1}`}.${extension}`
}

/**
 * 取原图字节。源站同源走后台的会话队列（带登录态、受 §12.4 节流与 stop 约束），
 * 其余一律走站外图床出口（不带会话、按域名授权）。
 */
async function downloadSource(
  context: ImportContext,
  source: ImageSource
): Promise<DownloadedImage> {
  if (isSameOrigin(source.url, context.settings.confluenceUrl)) {
    return downloadImage(source.url)
  }
  const reply = await sendMessage<DownloadedImage>({
    type: "image:bytes",
    url: source.url
  })
  if (!reply.ok) {
    throw new ImportError(reply.code, reply.message, {
      hint: reply.hint,
      status: reply.status
    })
  }
  return reply.data
}

/** 下载好的字节 → ciki 图床地址；附件与站外图共用这一尾部。 */
async function uploadBlobOne(
  context: ImportContext,
  source: ImageSource,
  downloaded: DownloadedImage
): Promise<ImageOutcome> {
  const { blob } = dataUrlToBlob(downloaded.dataUrl)
  // 反代有时回 application/octet-stream：按附件元数据/文件名补上 ciki 认的类型，
  // 否则上传被拒、图白抓一场。
  const contentType = isAcceptedImageType(blob.type)
    ? blob.type
    : normalizeImageType(downloaded.contentType, source.filename) ||
      normalizeImageType(source.mediaType, source.filename) ||
      blob.type
  if (!isAcceptedImageType(contentType)) {
    return {
      status: "failed",
      filename: source.filename,
      downloadUrl: source.url,
      reason: `图片格式 ciki 不收（${contentType || "未知类型"}，只收 png/jpg/gif/webp）`
    }
  }
  const filename = uploadFilename(source, downloaded, contentType)
  const uploadBlob =
    contentType !== blob.type ? new Blob([blob], { type: contentType }) : blob
  const uploaded = await context.api.upload(uploadBlob, filename)
  if (!isHostedImageSrc(uploaded.url)) {
    return {
      status: "failed",
      filename,
      downloadUrl: source.url,
      reason: "ciki 返回的图床地址不符合契约（/api/files/…）"
    }
  }
  return {
    status: "uploaded",
    url: uploaded.url,
    filename,
    downloadUrl: source.url
  }
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
  const source: ImageSource = {
    url: attachment.downloadUrl,
    filename: attachment.filename,
    index: -1,
    mediaType: attachment.mediaType
  }
  try {
    const downloaded = await downloadSource(context, source)
    return await uploadBlobOne(context, source, downloaded)
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

/** 失败但仍保留了原地址：report 的那一行必须把这件事说清楚。 */
function keepOriginalHint(outcome: ImageOutcome): ImageOutcome {
  if (outcome.status !== "failed" || !outcome.reason) return outcome
  return { ...outcome, reason: `${outcome.reason}，已保留原地址` }
}

/**
 * 按地址转存一张图（站外图，以及附件清单里匹配不到的图）。
 * 下载侧失败只算这一张：正文保留原地址，结果里给真实原因；
 * 源站同源的地址仍守 §12.4 的红线（429 / 登录失效整次停手）。
 */
async function uploadByAddress(
  context: ImportContext,
  source: ImageSource
): Promise<ImageOutcome> {
  if (!source.url) {
    return {
      status: "failed",
      filename: source.filename,
      reason: "没有可下载的图片地址"
    }
  }
  const sameOrigin = isSameOrigin(source.url, context.settings.confluenceUrl)
  let downloaded: DownloadedImage
  try {
    downloaded = await downloadSource(context, source)
  } catch (error) {
    const value = toImportError(error)
    if (value.stop && sameOrigin) throw value
    return {
      status: "failed",
      filename: source.filename,
      downloadUrl: source.url,
      // 站外图床的错误 message 本身就是一句人话，不再套「源站接口…」前缀
      reason: sameOrigin
        ? `${describeImportError(error)}，已保留原地址`
        : `${value.message}，已保留原地址`
    }
  }
  try {
    return keepOriginalHint(await uploadBlobOne(context, source, downloaded))
  } catch (error) {
    const value = toImportError(error)
    if (value.stop) throw value
    return {
      status: "failed",
      filename: source.filename,
      downloadUrl: source.url,
      reason: `${describeImportError(error)}，已保留原地址`
    }
  }
}

/**
 * 缓存键按来源区分：站外图按 URL，附件按「页面 + 文件名」，drawio 单独一族。
 * 否则别页与本页同名的 banner.png、或同名的 drawio 图会命中彼此的缓存。
 */
export function cacheKeyFor(ref: ImageRef): string {
  if (ref.kind === "external") return ref.url ? `url:${ref.url}` : ""
  const filename = ref.filename.trim().toLowerCase()
  if (!filename) return ""
  if (ref.kind === "drawio") return `drawio:${filename}`
  const scope = ref.pageId ? `page:${ref.pageId}:` : ""
  return `file:${scope}${filename}`
}

/**
 * 附件清单里匹配不到时的兜底地址：Confluence 标准的附件下载路径。
 * 引用别页附件时用 `<ri:page>` 给的 pageId，否则按本页。
 */
function attachmentDownloadGuess(
  context: ImportContext,
  ref: ImageRef
): string {
  // drawio 图名不是真文件名，猜出来的地址没有意义
  if (ref.kind === "drawio") return ""
  const filename = ref.filename.trim()
  if (!filename) return ""
  const pageId = (ref.pageId || context.pageId).trim()
  if (!pageId) return ""
  return `${context.base}/download/attachments/${encodeURIComponent(pageId)}/${encodeURIComponent(filename)}`
}

async function pipelineAttachmentRef(
  context: ImportContext,
  ref: ImageRef
): Promise<ImageOutcome> {
  const attachment = matchAttachment(context.attachments, ref)
  if (attachment) return uploadOne(context, attachment)
  const guess = attachmentDownloadGuess(context, ref)
  if (guess) {
    return uploadByAddress(context, {
      url: guess,
      filename: ref.filename,
      index: ref.index
    })
  }
  return {
    status: "failed",
    filename: ref.filename,
    reason:
      ref.kind === "drawio"
        ? "drawio 图没有配套的附件"
        : "附件清单里没有这个文件"
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
    const key = cacheKeyFor(ref)
    const cached = key ? cache.get(key) : undefined
    if (cached) {
      outcomes.set(ref.index, cached)
      continue
    }
    // 站外图与附件走同一条「下载 → 上传 → 回填」链路；分类只影响下载通道
    const outcome =
      ref.kind === "external"
        ? await uploadByAddress(context, {
            url: ref.url ?? "",
            filename: ref.filename,
            index: ref.index
          })
        : await pipelineAttachmentRef(context, ref)
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
    spaceId: decision.spaceId,
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
  const spaceName =
    context.spaces.find((space) => space.id === decision.spaceId)?.name ?? ""
  await saveSettings({
    defaultSpaceId: decision.spaceId,
    defaultSpaceName: spaceName,
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

  const report: ImportReport = {
    title: decision.title,
    sourceUrl: context.content.selfUrl,
    pageId: created.pageId,
    pageUrl,
    spaceName,
    conflict: decision.conflict,
    images: {
      total: context.prepared.refs.length,
      uploaded,
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
