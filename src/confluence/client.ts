/**
 * Confluence REST 的读侧客户端 —— 请求本身都在后台排队发出，
 * 这里只负责拼 URL、解析 JSON、把附件清单整理成可匹配的形状。
 */
import { ImportError } from "@/shared/errors"
import type { Reply } from "@/shared/messages"
import { sendMessage } from "@/shared/messages"

export interface ConfluenceContent {
  pageId: string
  title: string
  storage: string
  selfUrl: string
}

export interface Attachment {
  filename: string
  mediaType: string
  downloadUrl: string
  /** Confluence 认为它是图片（含 svg/bmp，ciki 不收）。 */
  isImage: boolean
  /** ciki 的图床收的格式：png/jpg/jpeg/gif/webp。 */
  uploadable: boolean
}

const UPLOADABLE_EXT = /\.(png|jpe?g|gif|webp)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const MAX_ATTACHMENT_PAGES = 10

export function contentUrl(base: string, pageId: string): string {
  return `${base}/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,version`
}

export function attachmentsUrl(base: string, pageId: string): string {
  return `${base}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?limit=200`
}

function unwrap<T>(reply: Reply<T>): T {
  if (reply.ok) return reply.data
  throw new ImportError(reply.code, reply.message, {
    hint: reply.hint,
    status: reply.status
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * 把 REST 返回的链接变成绝对地址。
 *
 * Confluence 的 `_links` 有两种写法：带 contextPath 的根相对路径（/wiki/download/…）
 * 与不带 contextPath 的（/download/…）。`_links.base`（也带 contextPath）能区分二者，
 * 这里不猜域名、只用请求方给的基址与该响应的 base。
 */
export function resolveLink(
  link: string,
  apiBase: string,
  linksBase = ""
): string {
  if (!link) return ""
  if (/^https?:\/\//i.test(link)) return link
  const origin = new URL(apiBase).origin
  if (!link.startsWith("/")) {
    return `${apiBase.replace(/\/+$/, "")}/${link.replace(/^\.?\//, "")}`
  }
  const contextPath = (() => {
    const source = /^https?:\/\//i.test(linksBase) ? linksBase : apiBase
    try {
      return new URL(source).pathname.replace(/\/+$/, "")
    } catch {
      return ""
    }
  })()
  if (contextPath && link.startsWith(`${contextPath}/`))
    return `${origin}${link}`
  return `${origin}${contextPath}${link}`
}

export async function loadContent(
  base: string,
  pageId: string
): Promise<ConfluenceContent> {
  const data = unwrap(
    await sendMessage<{ json: unknown }>({
      type: "confluence:json",
      url: contentUrl(base, pageId)
    })
  )
  const json = asRecord(data.json)
  const body = asRecord(json.body)
  const storage = asRecord(body.storage)
  const value = asString(storage.value)
  const title = asString(json.title)
  if (!title && !value) {
    throw new ImportError(
      "BAD_RESPONSE",
      "GET /rest/api/content 没有返回标题与正文（可能是接口权限或地址不对）"
    )
  }
  const links = asRecord(json._links)
  const selfUrl = resolveLink(
    asString(links.webui) || asString(links.tinyui),
    base,
    asString(links.base)
  )
  return {
    pageId,
    title: title || "未命名页面",
    storage: value,
    selfUrl
  }
}

function toAttachment(raw: unknown, apiBase: string): Attachment | null {
  const item = asRecord(raw)
  const filename = asString(item.title)
  if (!filename) return null
  const metadata = asRecord(item.metadata)
  const links = asRecord(item._links)
  const download = asString(links.download)
  const mediaType = asString(metadata.mediaType)
  const looksImage = mediaType.startsWith("image/") || IMAGE_EXT.test(filename)
  return {
    filename,
    mediaType,
    downloadUrl: download
      ? resolveLink(download, apiBase, asString(links.base))
      : "",
    isImage: looksImage,
    uploadable:
      mediaType === "image/png" ||
      mediaType === "image/jpeg" ||
      mediaType === "image/gif" ||
      mediaType === "image/webp" ||
      (!mediaType && UPLOADABLE_EXT.test(filename))
  }
}

/** 附件清单（按 _links.next 翻页，最多 10 页，仍然是串行队列）。 */
export async function loadAttachments(
  base: string,
  pageId: string
): Promise<Attachment[]> {
  const collected: Attachment[] = []
  let url = attachmentsUrl(base, pageId)
  for (let page = 0; page < MAX_ATTACHMENT_PAGES && url; page += 1) {
    const data = unwrap(
      await sendMessage<{ json: unknown }>({ type: "confluence:json", url })
    )
    const json = asRecord(data.json)
    const results = Array.isArray(json.results) ? json.results : []
    for (const item of results) {
      const attachment = toAttachment(item, base)
      if (attachment) collected.push(attachment)
    }
    const links = asRecord(json._links)
    const next = asString(links.next)
    url = next ? resolveLink(next, base, asString(links.base)) : ""
  }
  return collected
}

export interface DownloadedImage {
  dataUrl: string
  contentType: string
  filename: string
  byteLength: number
}

/** 取原图字节（后台带当前浏览器会话，串行 + 节流）。 */
export async function downloadImage(url: string): Promise<DownloadedImage> {
  return unwrap(
    await sendMessage<DownloadedImage>({ type: "confluence:bytes", url })
  )
}
