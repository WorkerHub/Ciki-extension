/**
 * 事件桥的 MAIN world 中继。
 *
 * 为什么需要它：content script 跑在 isolated world，读不到页面派发事件的 detail，
 * 页面也拿不到插件那边的对象。所以往页面里注入这个自包含函数（chrome.scripting
 * 会把它序列化过去，函数里不能引用任何模块作用域）：
 * - 页面派发的 hello / capture → window.postMessage 交给 isolated world；
 * - isolated world 的 postMessage → 在 MAIN world 里构造 CustomEvent 派给页面；
 * - 装完立刻派一次 plugin-hello（ciki 页可能比插件先挂载）。
 *
 * 契约（Ciki 侧 #9 冻结，拉取式四事件，全部在 `ciki:image-bridge:` 前缀下）：
 *   plugin-hello（插件→页，无 detail）
 *   hello{sources: string[]}（页→插件）
 *   capture{src: string}（页→插件）
 *   captured{src, dataUrl, filename, contentType}（插件→页，base64 不是 Blob）
 */
export const BRIDGE_PREFIX = "ciki:image-bridge:"

export const BRIDGE_EVENTS = {
  pluginHello: "plugin-hello",
  hello: "hello",
  capture: "capture",
  captured: "captured"
} as const

export const RELAY_FLAG = "__cikiImageBridgeRelay"

export interface RelayConfig {
  prefix: string
  flag: string
  pluginHello: string
  hello: string
  capture: string
}

export const RELAY_CONFIG: RelayConfig = {
  prefix: BRIDGE_PREFIX,
  flag: RELAY_FLAG,
  pluginHello: BRIDGE_EVENTS.pluginHello,
  hello: BRIDGE_EVENTS.hello,
  capture: BRIDGE_EVENTS.capture
}

/**
 * 注入到 MAIN world 的函数本体。
 * 只依赖 window/CustomEvent —— 它会被序列化后单独运行。
 */
export function installImageRelay(config: RelayConfig): boolean {
  const host = window as unknown as Record<string, unknown>
  const forwardToContent = (kind: string, detail: unknown) => {
    try {
      window.postMessage(
        { __cikiImageBridge: "to-content", kind, detail },
        window.location.origin
      )
    } catch {
      // 页面 origin 是 opaque（file:）时没人会用它，忽略
    }
  }

  if (!host[config.flag]) {
    host[config.flag] = true
    for (const name of [config.hello, config.capture]) {
      window.addEventListener(config.prefix + name, (event) => {
        forwardToContent(name, (event as CustomEvent).detail ?? null)
      })
    }
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data as {
        __cikiImageBridge?: string
        kind?: string
        detail?: unknown
      } | null
      if (data?.__cikiImageBridge !== "to-page" || !data.kind) return
      try {
        window.dispatchEvent(
          new CustomEvent(config.prefix + data.kind, { detail: data.detail })
        )
      } catch {
        // detail 不是可克隆对象时 dispatch 会失败，丢弃即可
      }
    })
  }

  window.dispatchEvent(new CustomEvent(config.prefix + config.pluginHello))
  return true
}
