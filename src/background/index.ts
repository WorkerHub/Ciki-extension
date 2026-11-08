/**
 * 后台服务工人：扩展里所有 Confluence 网络请求的唯一出口 + 内容脚本注册 + 事件桥中继。
 *
 * 为什么请求都放这里：
 * - 一个队列 -> 串行、固定间隔，节流口径只有一处；
 * - 服务工人被回收也不要紧，队列状态落 storage.session；
 * - 除了这里，没有任何地方能拿浏览器会话去请求 Confluence（域名白名单在这里查）。
 */
import {
  ConfluenceQueue,
  type QueueSnapshot
} from "@/background/confluence-queue"
import { installImageRelay, RELAY_CONFIG } from "@/content/relay"
import { arrayBufferToDataUrl } from "@/shared/bytes"
import { ImportError } from "@/shared/errors"
import { baseMimeType, normalizeImageType } from "@/shared/image-type"
import type { FetchedBytes, PageProbe, RequestMessage } from "@/shared/messages"
import { fail, ok } from "@/shared/messages"
import {
  loadQueueSnapshot,
  putRun,
  saveQueueSnapshot,
  setBridgeStatus
} from "@/shared/run-store"
import {
  isSameOrigin,
  loadSettings,
  originOf,
  type Settings
} from "@/shared/settings"

const CONTENT_SCRIPT_ID = "ciki-content"

let queue: ConfluenceQueue | null = null

async function getQueue(): Promise<ConfluenceQueue> {
  if (queue) return queue
  const snapshot = await loadQueueSnapshot()
  queue = new ConfluenceQueue(
    {
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onRecord: (state: QueueSnapshot) => {
        void saveQueueSnapshot(state)
      }
    },
    snapshot
  )
  return queue
}

/** 只允许请求用户填的那一个 Confluence 实例（协议 + 域名 + 端口都要对上）。 */
async function assertAllowed(url: string): Promise<Settings> {
  const settings = await loadSettings()
  if (!settings.confluenceUrl) {
    throw new ImportError("UNEXPECTED", "还没填写源站地址", {
      hint: "点插件图标 →「设置」填源站地址，并允许访问该域名。"
    })
  }
  if (!isSameOrigin(url, settings.confluenceUrl)) {
    throw new ImportError("UNEXPECTED", "拒绝请求：这个地址不属于已配置的源站")
  }
  return settings
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split("/").pop() || "")
  } catch {
    return ""
  }
}

async function fetchJson(url: string): Promise<{ json: unknown }> {
  await assertAllowed(url)
  const instance = await getQueue()
  const response = await instance.fetch(url, {
    headers: { Accept: "application/json" }
  })
  const text = await response.text()
  try {
    return { json: text ? JSON.parse(text) : null }
  } catch {
    throw new ImportError("BAD_RESPONSE", "源站返回的不是 JSON（地址可能不对）")
  }
}

/** 导出给测试：附件字节下载 + MIME 归一（ciki 只认白名单里的四种）。 */
export async function fetchBytes(url: string): Promise<FetchedBytes> {
  await assertAllowed(url)
  const instance = await getQueue()
  const response = await instance.fetch(url)
  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) {
    throw new ImportError("HTTP", "附件下载回来是空的（可能是权限或附件已删）")
  }
  const filename = filenameFromUrl(url)
  const rawType = response.headers.get("content-type") || ""
  // 归一成 ciki 认的 MIME（去 ;charset=、image/jpg→image/jpeg、按扩展名兜底）：
  // 带参数的 data URL 与 contentType 会被 ciki 的校验直接判非法。
  const contentType =
    normalizeImageType(rawType, filename) || baseMimeType(rawType)
  return {
    dataUrl: arrayBufferToDataUrl(buffer, contentType),
    contentType,
    filename,
    byteLength: buffer.byteLength
  }
}

async function prepareRun(
  message: Extract<RequestMessage, { type: "run:prepare" }>,
  sender: chrome.runtime.MessageSender
): Promise<{ runId: string }> {
  const tabId = message.tabId ?? sender.tab?.id
  if (!tabId) throw new ImportError("UNEXPECTED", "拿不到当前标签页")
  const probe: PageProbe =
    message.probe ??
    (await probeTab(tabId).catch(() => null)) ??
    ({
      pageId: "",
      contextPath: "",
      pageUrl: "",
      documentTitle: ""
    } as PageProbe)
  if (!probe.pageId) {
    throw new ImportError(
      "NOT_FOUND",
      "当前页没有 pageId，先打开一篇源站的文档页"
    )
  }

  const runId = crypto.randomUUID()
  await putRun({ runId, tabId, probe, createdAt: Date.now() })
  await chrome.windows.create({
    url: chrome.runtime.getURL(`confirm.html?run=${runId}`),
    type: "popup",
    width: 520,
    height: 760
  })
  return { runId }
}

/** popup 触发时的兜底探测：注入 probe 的逻辑等价于 content script 的那份。 */
async function probeTab(tabId: number): Promise<PageProbe> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = document.querySelector('meta[name="ajs-page-id"]')
      const metaId = meta?.getAttribute("content") || ""
      const ajs = (
        window as unknown as { AJS?: { params?: Record<string, unknown> } }
      ).AJS
      const ajsId = ajs?.params?.pageId ? String(ajs.params.pageId) : ""
      const query = /[?&]pageId=(\d+)/.exec(window.location.search)
      const path = /\/pages\/(\d+)/.exec(window.location.pathname)
      const metaCtx =
        document
          .querySelector('meta[name="ajs-context-path"]')
          ?.getAttribute("content") || ""
      const ajsCtx =
        typeof ajs?.params?.contextPath === "string"
          ? ajs.params.contextPath
          : ""
      return {
        pageId: metaId || ajsId || query?.[1] || path?.[1] || "",
        contextPath: (ajsCtx || metaCtx).replace(/\/+$/, ""),
        pageUrl: window.location.href,
        documentTitle: document.title
      }
    }
  })
  return injection?.result as PageProbe
}

async function installRelay(tabId: number): Promise<{ installed: boolean }> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installImageRelay,
    args: [RELAY_CONFIG]
  })
  return { installed: true }
}

/** 按已授权域名注册 / 更新 / 注销内容脚本。没授权就什么都不注册。 */
async function syncContentScripts(): Promise<void> {
  const settings = await loadSettings()
  const origins = [
    originOf(settings.confluenceUrl),
    originOf(settings.cikiUrl)
  ].filter(Boolean)
  const patterns: string[] = []
  for (const origin of origins) {
    if (!origin) continue
    const pattern = `${origin}/*`
    if (patterns.includes(pattern)) continue
    const granted = await chrome.permissions.contains({ origins: [pattern] })
    if (granted) patterns.push(pattern)
  }

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID]
    })
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({
        ids: [CONTENT_SCRIPT_ID]
      })
    }
    if (patterns.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: patterns,
          js: ["content.js"],
          runAt: "document_idle",
          allFrames: false,
          persistAcrossSessions: true
        }
      ])
    }
  } catch (error) {
    console.warn("[ciki] 注册内容脚本失败", error)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void syncContentScripts()
})

chrome.runtime.onStartup.addListener(() => {
  void syncContentScripts()
})

chrome.permissions.onAdded.addListener(() => {
  void syncContentScripts()
})

chrome.permissions.onRemoved.addListener(() => {
  void syncContentScripts()
})

chrome.runtime.onMessage.addListener(
  (
    message: RequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (value: unknown) => void
  ) => {
    const run = async (): Promise<unknown> => {
      switch (message?.type) {
        case "run:prepare":
          return ok(await prepareRun(message, sender))
        case "confluence:json":
          return ok(await fetchJson(message.url))
        case "confluence:bytes":
          return ok(await fetchBytes(message.url))
        case "bridge:fetch":
          return ok(await fetchBytes(message.src))
        case "bridge:install": {
          const tabId = sender.tab?.id
          if (!tabId) throw new ImportError("UNEXPECTED", "拿不到当前标签页")
          return ok(await installRelay(tabId))
        }
        case "bridge:status":
          await setBridgeStatus({
            ok: message.ok,
            message: message.message,
            src: message.src,
            at: Date.now()
          })
          return ok(true)
        case "queue:stats":
          return ok({ snapshot: (await getQueue()).snapshot() })
        case "settings:changed":
          await syncContentScripts()
          return ok(true)
        default:
          return fail(new ImportError("UNEXPECTED", "未知消息"))
      }
    }

    void run()
      .then(sendResponse)
      .catch((error) => sendResponse(fail(error)))
    return true
  }
)
