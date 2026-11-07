/**
 * ciki 导入接口客户端 —— 插件里唯一跟 ciki 说话的地方。
 *
 * 字段一律按 #6 已冻结进 Ciki 仓 docs/api-contract.md 的 camelCase：
 * - GET  /api/import/parents  → [{ id, title, parentId }]
 * - POST /api/import/check    ← { title, parentId } → { exists, pageId? }
 * - POST /api/import/files    （multipart，字段名 file）→ { url }
 * - POST /api/import/pages    ← { title, parentId, contentJson, conflict } → { pageId, url }
 * 鉴权是导入令牌：Authorization: Bearer <token>，不接受会话 Cookie（职责分离）。
 */
import { ImportError } from "@/shared/errors"

export interface ImportParent {
  id: string
  title: string
  parentId: string | null
}

export interface CheckResult {
  exists: boolean
  pageId?: string
}

export interface CreatePageInput {
  title: string
  parentId: string | null
  contentJson: string
  conflict: "update" | "create_copy"
}

export interface CreatePageResult {
  pageId: string
  url?: string
}

export interface UploadedImage {
  url: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class ImportApi {
  private readonly base: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.base = baseUrl.replace(/\/+$/, "")
    this.token = token.trim()
  }

  private async request(
    path: string,
    init: RequestInit = {}
  ): Promise<unknown> {
    const url = `${this.base}${path}`
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(init.headers ?? {})
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ImportError("NETWORK", message, {
        hint: "连不上 ciki：检查设置里的 ciki 地址，以及浏览器是否给这个域名授权了插件访问。"
      })
    }
    if (response.status === 401) {
      throw new ImportError("TOKEN_INVALID", "导入令牌被拒绝（401）", {
        status: 401
      })
    }
    if (response.status === 413) {
      throw new ImportError("PAYLOAD_TOO_LARGE", "ciki 拒收（413）", {
        status: 413
      })
    }
    if (response.status === 429) {
      throw new ImportError("RATE_LIMITED", "ciki 返回 429", { status: 429 })
    }
    if (!response.ok) {
      const body = asRecord(await readJson(response))
      const detail = asString(body.error) || `HTTP ${response.status}`
      throw new ImportError("HTTP", detail, { status: response.status })
    }
    return readJson(response)
  }

  async parents(): Promise<ImportParent[]> {
    const body = await this.request("/api/import/parents")
    if (!Array.isArray(body)) {
      throw new ImportError(
        "BAD_RESPONSE",
        "/api/import/parents 返回的不是数组"
      )
    }
    return body.map((item) => {
      const record = asRecord(item)
      return {
        id: asString(record.id),
        title: asString(record.title),
        parentId: asString(record.parentId) || null
      }
    })
  }

  async check(title: string, parentId: string | null): Promise<CheckResult> {
    const body = asRecord(
      await this.request("/api/import/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentId })
      })
    )
    return {
      exists: Boolean(body.exists),
      pageId: asString(body.pageId) || undefined
    }
  }

  /** 单张图片上传（串行调用方负责一次只传一张）。 */
  async upload(bytes: Blob, filename: string): Promise<UploadedImage> {
    const form = new FormData()
    form.append("file", bytes, filename)
    const body = asRecord(
      await this.request("/api/import/files", { method: "POST", body: form })
    )
    const url = asString(body.url)
    if (!url) {
      throw new ImportError("BAD_RESPONSE", "/api/import/files 没有返回 url")
    }
    return { url }
  }

  async createPage(input: CreatePageInput): Promise<CreatePageResult> {
    const body = asRecord(
      await this.request("/api/import/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          parentId: input.parentId,
          contentJson: input.contentJson,
          conflict: input.conflict
        })
      })
    )
    const pageId = asString(body.pageId)
    if (!pageId) {
      throw new ImportError("BAD_RESPONSE", "/api/import/pages 没有返回 pageId")
    }
    return { pageId, url: asString(body.url) || undefined }
  }
}

/** data URL ↔ Blob 的转换放在 shared/bytes，这里只做转出，方便调用方一次 import。 */
export { arrayBufferToDataUrl, dataUrlToBlob } from "@/shared/bytes"
