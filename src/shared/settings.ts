/**
 * 插件设置 —— 全部存在 chrome.storage.local，源码里不出现任何域名。
 *
 * 两个地址都由用户自己填：
 * - confluenceUrl：实例地址（自建版填站点根；Cloud 版带到 /wiki）；
 * - cikiUrl：ciki 的访问地址，用于导入接口与「在 ciki 打开」。
 * 导入令牌是 ciki 设置页生成的一次性明文，只存本地、不外传。
 */

export const SETTINGS_KEY = "settings"

export interface Settings {
  confluenceUrl: string
  cikiUrl: string
  importToken: string
  defaultParentId: string | null
  defaultParentTitle: string
  /** 探测成功后记住的可用基址（含 contextPath），下次优先用它。 */
  confluenceBase: string
}

export const EMPTY_SETTINGS: Settings = {
  confluenceUrl: "",
  cikiUrl: "",
  importToken: "",
  defaultParentId: null,
  defaultParentTitle: "",
  confluenceBase: ""
}

/** 只接受 http(s)，去掉尾斜杠与 hash：其它协议（file:/javascript:）一律不受理。 */
export function normalizeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!url.hostname) return null
  url.hash = ""
  const path = url.pathname.replace(/\/+$/, "")
  return `${url.origin}${path}${url.search}`
}

/** 站点 origin（协议 + 域名 + 端口）；非法地址返回空串。 */
export function originOf(raw: string): string {
  const normalized = normalizeHttpUrl(raw)
  if (!normalized) return ""
  return new URL(normalized).origin
}

/**
 * 按用户填的实际协议拼可选域名权限的 match pattern（http 站点只申请 http）。
 * 与 manifest 里可选域名的全站通配声明配合，用户保存地址时才按需申请。
 */
export function permissionPattern(raw: string): string | null {
  const origin = originOf(raw)
  return origin ? `${origin}/*` : null
}

/** 同一个站点（协议 + 域名 + 端口）才允许用当前浏览器会话去取。 */
export function isSameOrigin(url: string, raw: string): boolean {
  const origin = originOf(raw)
  if (!origin) return false
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return false
  return new URL(normalized).origin === origin
}

export function isConfigured(settings: Settings): boolean {
  return Boolean(
    originOf(settings.confluenceUrl) &&
      originOf(settings.cikiUrl) &&
      settings.importToken.trim()
  )
}

/**
 * 取正文时的基址候选：页面自己报的 contextPath 最可信，其次学到的基址、
 * 用户填的地址，最后是站点根。逐个试，第一个 200 的记下来。
 */
export function baseCandidates(settings: Settings, contextPath = ""): string[] {
  const candidates: string[] = []
  const origin = originOf(settings.confluenceUrl)
  const ctx = contextPath.trim().replace(/\/+$/, "")
  if (origin && ctx && ctx !== "/") candidates.push(`${origin}${ctx}`)
  if (settings.confluenceBase) candidates.push(settings.confluenceBase)
  if (settings.confluenceUrl) candidates.push(settings.confluenceUrl)
  if (origin) candidates.push(origin)
  return dedupe(candidates.map((value) => normalizeHttpUrl(value) ?? ""))
}

export function dedupe(values: string[]): string[] {
  return values.filter(
    (value, index) => value && values.indexOf(value) === index
  )
}

function storageArea(): chrome.storage.StorageArea {
  return chrome.storage.local
}

export async function loadSettings(): Promise<Settings> {
  const stored = await storageArea().get(SETTINGS_KEY)
  const value = stored[SETTINGS_KEY] as Partial<Settings> | undefined
  return { ...EMPTY_SETTINGS, ...(value ?? {}) }
}

export async function saveSettings(
  patch: Partial<Settings>
): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  await storageArea().set({ [SETTINGS_KEY]: next })
  return next
}

/** 设置变更广播：后台据此重注册 content script。 */
export async function notifySettingsChanged(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "settings:changed" })
  } catch {
    // 后台还没醒、或页面正在卸载：下一次事件会补上，不打扰用户
  }
}
