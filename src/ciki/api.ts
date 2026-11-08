/**
 * ciki 导入接口客户端 —— 插件里唯一跟 ciki 说话的地方。
 *
 * 字段按 Ciki 仓 docs/api-contract.md 冻结的契约：会话侧 camelCase，
 * 导入侧保留 space_id 这组 snake_case（插件导出契约就是这么定的）。
 * - GET  /api/import/spaces           → [{ id, name }]（可编辑的空间，默认空间在前）
 * - GET  /api/import/parents?space_id= → [{ id, title, parentId }]
 * - POST /api/import/check            ← { title, parentId, space_id } → { exists, pageId? }
 * - POST /api/import/files            （multipart，字段名 file）→ { url }
 * - POST /api/import/pages            ← { title, parentId, space_id, contentJson, conflict } → { pageId, url }
 * 鉴权是导入令牌：Authorization: Bearer <token>，不接受会话 Cookie（职责分离）。
 */
import { ImportError, type ImportErrorCode } from "@/shared/errors"

export interface ImportSpace {
  id: string
  name: string
}

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
  /** 写入落点；插件始终显式给出，不依赖服务端的默认空间兜底。 */
  spaceId: string
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

/** ciki 导入接口用 code 表达的业务错误，在这里翻成人话。 */
const SPACE_ERRORS: Record<
  string,
  { code: ImportErrorCode; title: string; hint: string }
> = {
  SPACE_FORBIDDEN: {
    code: "SPACE_FORBIDDEN",
    title: "没有这个空间的写入权限",
    hint: "换一个空间，或让空间管理员把你的角色改成 editor 及以上。"
  },
  SPACE_MISMATCH: {
    code: "SPACE_MISMATCH",
    title: "父页不在所选空间",
    hint: "关掉弹窗重新剪藏一次，让空间与父级重新读一遍。"
  },
  DEFAULT_SPACE_MISSING: {
    code: "DEFAULT_SPACE_MISSING",
    title: "ciki 还没完成数据库升级",
    hint: "让管理员在 ciki 的「系统管理 → 数据库维护」里做一次升级，然后重新剪藏。"
  }
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
      const mapped = SPACE_ERRORS[asString(body.code)]
      if (mapped) {
        throw new ImportError(mapped.code, detail, {
          title: mapped.title,
          hint: mapped.hint,
          status: response.status
        })
      }
      throw new ImportError("HTTP", detail, { status: response.status })
    }
    return readJson(response)
  }

  /** 导入令牌可写入的空间；默认空间排在最前，但接口不给 isDefault 标记。 */
  async spaces(): Promise<ImportSpace[]> {
    let body: unknown
    try {
      body = await this.request("/api/import/spaces")
    } catch (error) {
      // 老版本 ciki 没有这个端点：别报成「结构对不上」，直接说清楚要升级
      if (error instanceof ImportError && error.status === 404) {
        throw new ImportError("HTTP", "ciki 上没有 /api/import/spaces（404）", {
          status: 404,
          title: "ciki 还没有空间接口",
          hint: "插件与 ciki 版本对不上：让管理员把 ciki 升级到带空间（Space）的版本后再剪藏。"
        })
      }
      throw error
    }
    if (!Array.isArray(body)) {
      throw new ImportError("BAD_RESPONSE", "/api/import/spaces 返回的不是数组")
    }
    return body
      .map((item) => {
        const record = asRecord(item)
        const id = asString(record.id)
        return { id, name: asString(record.name) || id }
      })
      .filter((space) => space.id !== "")
  }

  async parents(spaceId = ""): Promise<ImportParent[]> {
    const query = spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : ""
    const body = await this.request(`/api/import/parents${query}`)
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

  async check(
    title: string,
    parentId: string | null,
    spaceId: string
  ): Promise<CheckResult> {
    const body = asRecord(
      await this.request("/api/import/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentId, space_id: spaceId })
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
          space_id: input.spaceId,
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

/**
 * 把导入接口回的 url 变成可点的绝对地址。
 *
 * 真实后端回的是根相对路径 `/p/<pageId>`：直接塞进 `<a href>` 会被浏览器当成本页
 * （扩展页）的相对路径，点开就是 chrome-extension://…/p/… 的 404。
 */
export function cikiPageUrl(
  cikiUrl: string,
  url?: string,
  pageId?: string
): string {
  const target = (url ?? "").trim() || (pageId ? `/p/${pageId}` : "")
  if (!target) return ""
  if (/^https?:\/\//i.test(target)) return target
  const base = cikiUrl.trim().replace(/\/+$/, "")
  if (!base) return target
  return `${base}${target.startsWith("/") ? "" : "/"}${target}`
}

/** data URL ↔ Blob 的转换放在 shared/bytes，这里只做转出，方便调用方一次 import。 */
export { arrayBufferToDataUrl, dataUrlToBlob } from "@/shared/bytes"
