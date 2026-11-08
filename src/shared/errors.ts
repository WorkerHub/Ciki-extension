/**
 * 错误分类与用户文案。
 *
 * §12.4 红线要求：遇 429 或重定向到登录页立刻停手、分类报错、不重试硬闯。
 * 所以这两类错误带 stop 标记，界面只给「关闭 / 去登录」，不给重试按钮。
 */

export type ImportErrorCode =
  | "LOGIN_REQUIRED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "NETWORK"
  | "HTTP"
  | "TOKEN_INVALID"
  | "PAYLOAD_TOO_LARGE"
  | "BAD_RESPONSE"
  | "SPACE_FORBIDDEN"
  | "SPACE_MISMATCH"
  | "DEFAULT_SPACE_MISSING"
  | "UNEXPECTED"

const STOP_CODES = new Set<ImportErrorCode>(["LOGIN_REQUIRED", "RATE_LIMITED"])

const TITLES: Record<ImportErrorCode, string> = {
  LOGIN_REQUIRED: "源站登录已失效",
  RATE_LIMITED: "源站正在限流",
  NOT_FOUND: "源站上找不到这一页",
  NETWORK: "连不上源站",
  HTTP: "源站接口返回异常",
  TOKEN_INVALID: "ciki 导入令牌无效",
  PAYLOAD_TOO_LARGE: "页面内容超出 ciki 上限",
  BAD_RESPONSE: "接口返回的结构对不上",
  SPACE_FORBIDDEN: "没有这个空间的写入权限",
  SPACE_MISMATCH: "父页不在所选空间",
  DEFAULT_SPACE_MISSING: "ciki 还没完成数据库升级",
  UNEXPECTED: "没预料到的错误"
}

const HINTS: Record<ImportErrorCode, string> = {
  LOGIN_REQUIRED:
    "在浏览器里重新登录源站后再试。插件不会替你登录，也不会读取 cookie。",
  RATE_LIMITED:
    "插件已立即停手，不会重试。等几分钟再手动剪藏这一页，不要连着重试。",
  NOT_FOUND: "检查设置里的源站地址是否填对，以及这个账号有没有该页的浏览权限。",
  NETWORK: "检查网络、代理，或源站地址是否可达。",
  HTTP: "看下面的状态码；403 通常是接口权限，404 可能是源站地址的 contextPath 不对。",
  TOKEN_INVALID: "到 ciki 设置页重新生成导入令牌，填进插件设置。",
  PAYLOAD_TOO_LARGE: "这一页内容过大，ciki 存不下；拆页后再剪藏。",
  BAD_RESPONSE: "ciki 的导入接口返回了预期之外的字段，请把这条报给维护者。",
  SPACE_FORBIDDEN: "换一个空间，或让空间管理员把你的角色改成 editor 及以上。",
  SPACE_MISMATCH: "关掉弹窗重新剪藏一次，让空间与父级重新读一遍。",
  DEFAULT_SPACE_MISSING:
    "让管理员在 ciki 的「系统管理 → 数据库维护」里做一次升级，然后重新剪藏。",
  UNEXPECTED: "把这条报给维护者，附上截图与时间。"
}

export interface ImportErrorOptions {
  /** 覆盖默认标题（需要比 code 更具体的说法时用）。 */
  title?: string
  hint?: string
  /** HTTP 状态码（Confluence 或 ciki）。 */
  status?: number
  retryAfter?: number
}

export class ImportError extends Error {
  readonly code: ImportErrorCode
  readonly customTitle?: string
  readonly hint: string
  readonly status?: number
  readonly retryAfter?: number

  constructor(
    code: ImportErrorCode,
    message?: string,
    options: ImportErrorOptions = {}
  ) {
    super(message || TITLES[code])
    this.name = "ImportError"
    this.code = code
    this.customTitle = options.title
    this.hint = options.hint ?? HINTS[code]
    this.status = options.status
    this.retryAfter = options.retryAfter
  }

  get title(): string {
    return this.customTitle ?? TITLES[this.code]
  }

  /** true = 按红线立刻停手，界面不给重试入口。 */
  get stop(): boolean {
    return STOP_CODES.has(this.code)
  }
}

export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError
}

export function toImportError(error: unknown): ImportError {
  if (isImportError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ImportError("UNEXPECTED", message)
}

/** 一行式文案：标题 + 细节（日志与报告用）。 */
export function describeImportError(error: unknown): string {
  const value = toImportError(error)
  return value.message && value.message !== value.title
    ? `${value.title}：${value.message}`
    : value.title
}
