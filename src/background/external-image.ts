/**
 * 站外图床的字节出口 —— 与 Confluence 队列分开的一条路。
 *
 * 为什么不并进 ConfluenceQueue：
 * - 队列的红线语义（重定向=登录失效、429 立刻停手）只属于源站；第三方图床回 302
 *   或 429 不该把整页搬运掀翻，单张失败就是单张失败；
 * - 站外地址是任意第三方，请求一律 `credentials: "omit"`：不拿用户会话去取任意
 *   URL，需要登录才给图的站外图按失败如实上报；
 * - 跨域靠 `optional_host_permissions` 的按需授权（用户在确认小窗里点头），
 *   没授权就报 HOST_PERMISSION，绝不偷偷降级成热链。
 *
 * 错误 message 直接是给人看的一句话（上层拿它当逐图失败原因），不套默认标题。
 */
import { arrayBufferToDataUrl } from "@/shared/bytes"
import { ImportError } from "@/shared/errors"
import {
  baseMimeType,
  isAcceptedImageType,
  normalizeImageType
} from "@/shared/image-type"
import type { FetchedBytes } from "@/shared/messages"

export const EXTERNAL_IMAGE_TIMEOUT_MS = 15_000

export interface ExternalImageDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  hasPermission: (pattern: string) => Promise<boolean>
}

const DEFAULT_DEPS: ExternalImageDeps = {
  fetch: (url, init) => fetch(url, init),
  hasPermission: (pattern) =>
    chrome.permissions.contains({ origins: [pattern] })
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split("/").pop() || "")
  } catch {
    return ""
  }
}

/** 状态码翻成人话：单张失败的「真实原因」就是这一句。 */
function describeStatus(status: number): string {
  if (status === 401) return "HTTP 401（这个图片需要登录后才能取）"
  if (status === 403) return "HTTP 403（多半是防盗链或需要登录）"
  if (status === 404) return "HTTP 404（图片已被删除或地址失效）"
  if (status === 429) return "HTTP 429（图片站点限流）"
  return `HTTP ${status}`
}

function describeFetchFailure(
  error: unknown,
  host: string,
  timeoutMs: number
): string {
  const name = error instanceof Error ? error.name : ""
  if (name === "TimeoutError" || name === "AbortError") {
    return `下载超时（${Math.round(timeoutMs / 1000)} 秒没有响应）`
  }
  const message = error instanceof Error ? error.message : String(error)
  return `连不上 ${host}（${message}）`
}

/** 类型不是 ciki 收的那四种时，说清楚拿回来的是什么。 */
function describeType(contentType: string): string {
  if (contentType.startsWith("image/")) {
    return `图片格式 ciki 不收（${contentType}，只收 png/jpg/gif/webp）`
  }
  return `下载回来的不是图片（${contentType || "没有 content-type"}）`
}

/**
 * 取一张站外图的字节。
 * @param timeoutMs 单张超时（默认 15s；测试用短值验超时分支）
 */
export async function fetchExternalBytes(
  url: string,
  deps: Partial<ExternalImageDeps> = {},
  timeoutMs = EXTERNAL_IMAGE_TIMEOUT_MS
): Promise<FetchedBytes> {
  const { fetch: doFetch, hasPermission } = { ...DEFAULT_DEPS, ...deps }

  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new ImportError("UNEXPECTED", "站外图地址不是合法 URL")
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new ImportError(
      "UNEXPECTED",
      `站外图地址不是 http(s)（${target.protocol}）`
    )
  }
  if (!(await hasPermission(`${target.origin}/*`))) {
    throw new ImportError("HOST_PERMISSION", `没有授权读取 ${target.host}`)
  }

  let response: Response
  try {
    response = await doFetch(url, {
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new ImportError(
      "NETWORK",
      describeFetchFailure(error, target.host, timeoutMs)
    )
  }

  if (!response.ok) {
    throw new ImportError("HTTP", describeStatus(response.status), {
      status: response.status
    })
  }

  const filename = filenameFromUrl(url)
  const rawType = response.headers.get("content-type") || ""
  const declared = baseMimeType(rawType)
  // 只有「声明不具体」时才按扩展名兜底：text/html / image/svg+xml 是真实答复，
  // 不能因为 URL 结尾是 .png 就把登录页当图片塞给 ciki。
  const generic =
    !declared ||
    declared === "application/octet-stream" ||
    declared === "binary/octet-stream"
  const contentType = generic
    ? normalizeImageType(declared, filename)
    : normalizeImageType(declared, "")
  if (!isAcceptedImageType(contentType)) {
    throw new ImportError("BAD_RESPONSE", describeType(declared))
  }

  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) {
    throw new ImportError("BAD_RESPONSE", "下载回来是空的（可能没有这张图）")
  }
  return {
    dataUrl: arrayBufferToDataUrl(buffer, contentType),
    contentType,
    filename,
    byteLength: buffer.byteLength
  }
}
