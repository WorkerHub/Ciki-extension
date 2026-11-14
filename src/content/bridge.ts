/**
 * 粘贴补抓的插件侧（ciki 编辑页）。
 *
 * 契约来自 Ciki 侧 #9（拉取式四事件）：页面发 hello{sources} 或 capture{src}，
 * 插件把字节（base64 data URL）用 captured{src, dataUrl, filename, contentType} 交回去。
 * 插件不读、不改编辑器 DOM，也不在页面上放任何按钮 —— 「重试自动转存」是 ciki 那边的事。
 *
 * 失败时不派 captured（契约里没有错误字段）：标黄与重试入口由 ciki 侧保留，
 * 插件把原因写进 storage.session，popup 里能看到。
 */

import type { Reply } from "@/shared/messages"
import { BRIDGE_EVENTS, BRIDGE_PREFIX } from "./relay"

export interface BridgeBytes {
  dataUrl: string
  contentType: string
  filename: string
}

export interface BridgeDeps {
  fetchBytes: (src: string) => Promise<Reply<BridgeBytes>>
  postToPage: (kind: string, detail: unknown) => void
  /** 只抓已配置 Confluence 实例的地址：绝不能拿用户会话去取任意 URL。 */
  isAllowedSrc: (src: string) => boolean
  onFailure: (message: string, src: string) => void
  onSuccess?: (src: string) => void
}

export interface Bridge {
  start: () => void
  stop: () => void
  announce: () => void
  handleMessage: (data: unknown) => Promise<void>
  handleHello: (sources: unknown) => Promise<void>
  handleCapture: (src: unknown) => Promise<void>
}

function readSources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const sources: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const trimmed = item.trim()
    if (trimmed && !sources.includes(trimmed)) sources.push(trimmed)
  }
  return sources
}

export function createBridge(deps: BridgeDeps): Bridge {
  /** 已经抓过的结果：页面重复问同一张图时直接重发，不重复打 Confluence。 */
  const captured = new Map<string, BridgeBytes>()
  let stopped = false
  let listener: ((event: MessageEvent) => void) | null = null

  const announce = () => {
    deps.postToPage(BRIDGE_EVENTS.pluginHello, null)
  }

  const captureOne = async (raw: string, refresh = false) => {
    if (stopped) return
    const src = raw.trim()
    if (!src) return
    // capture 是用户点「重试自动转存」发起的：必须真的再打一次 Confluence，
    // 不能被上一次（可能已经失败或过期的）结果糊弄过去。
    if (refresh) captured.delete(src)
    const cached = captured.get(src)
    if (cached) {
      deps.postToPage(BRIDGE_EVENTS.captured, { src, ...cached })
      return
    }
    if (!deps.isAllowedSrc(src)) {
      deps.onFailure("这张图不在已配置的源站上，插件不会用登录态去取", src)
      return
    }
    const reply = await deps.fetchBytes(src)
    if (stopped) return
    if (!reply.ok) {
      deps.onFailure(reply.message, src)
      return
    }
    const payload: BridgeBytes = {
      dataUrl: reply.data.dataUrl,
      contentType: reply.data.contentType,
      filename: reply.data.filename
    }
    captured.set(src, payload)
    deps.postToPage(BRIDGE_EVENTS.captured, { src, ...payload })
    deps.onSuccess?.(src)
  }

  const handleHello = async (sources: unknown) => {
    for (const src of readSources(sources)) {
      if (stopped) return
      await captureOne(src)
    }
  }

  const handleCapture = async (src: unknown) => {
    if (typeof src !== "string") return
    await captureOne(src, true)
  }

  const handleMessage = async (data: unknown) => {
    if (stopped) return
    const message = data as {
      __cikiImageBridge?: string
      kind?: string
      detail?: unknown
    } | null
    if (message?.__cikiImageBridge !== "to-content") return
    if (message.kind === BRIDGE_EVENTS.hello) {
      const detail = message.detail as { sources?: unknown } | null
      await handleHello(detail?.sources)
      return
    }
    if (message.kind === BRIDGE_EVENTS.capture) {
      const detail = message.detail as { src?: unknown } | null
      await handleCapture(detail?.src)
    }
  }

  const start = () => {
    if (listener) return
    listener = (event: MessageEvent) => {
      if (event.source !== window) return
      void handleMessage(event.data)
    }
    window.addEventListener("message", listener)
    announce()
  }

  const stop = () => {
    stopped = true
    if (listener) {
      window.removeEventListener("message", listener)
      listener = null
    }
  }

  return { start, stop, announce, handleMessage, handleHello, handleCapture }
}

export function postToPage(kind: string, detail: unknown): void {
  try {
    window.postMessage(
      { __cikiImageBridge: "to-page", kind, detail },
      window.location.origin
    )
  } catch {
    // opaque origin 下没有页面会听，忽略
  }
}

export const BRIDGE_EVENT_NAMES = {
  prefix: BRIDGE_PREFIX,
  ...BRIDGE_EVENTS
}
