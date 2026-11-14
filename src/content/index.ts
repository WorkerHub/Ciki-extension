/**
 * content script 的唯一入口（打成 IIFE，按当前页面所属的站点分流）：
 * - 用户在设置里填的 Confluence 实例：标题旁挂「搬到 ciki」按钮；
 * - ciki：粘贴补抓的事件桥插件侧（只认后台，不碰编辑器 DOM）。
 *
 * 同一份脚本会被 registerContentScripts 注册到两个已授权域名，也会被 popup
 * 用 activeTab 按需注入 —— 所以入口必须幂等。
 */

import type { PageProbe } from "@/shared/messages"
import { sendMessage } from "@/shared/messages"
import {
  isSameOrigin,
  loadSettings,
  originOf,
  type Settings
} from "@/shared/settings"
import { createBridge } from "./bridge"
import { mountConfluenceButton } from "./confluence"
import { probeConfluencePage } from "./probe"

const GUARD = "__cikiHelperMounted"

/** 连点入口时只开一个小窗：置位到消息回来为止。 */
let starting = false

interface BridgeBytes {
  dataUrl: string
  contentType: string
  filename: string
}

function currentProbe(): PageProbe {
  const probed = probeConfluencePage()
  return {
    pageId: probed.pageId,
    contextPath: probed.contextPath,
    pageUrl: window.location.href,
    documentTitle: document.title
  }
}

async function startRun(): Promise<void> {
  if (starting) return
  const probe = currentProbe()
  if (!probe.pageId) {
    console.info("[ciki] 当前页没有 pageId，可能不是源站的内容页")
    return
  }
  starting = true
  try {
    const reply = await sendMessage<{ runId: string }>({
      type: "run:prepare",
      probe
    })
    if (!reply.ok) {
      console.warn(`[ciki] 打开确认小窗失败：${reply.message}`)
    }
  } finally {
    starting = false
  }
}

function listenForPopup(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: { type?: string } | undefined,
      _sender: unknown,
      sendResponse: (value: unknown) => void
    ) => {
      if (message?.type === "page:start") {
        void startRun().then(() => sendResponse({ ok: true }))
        return true
      }
      return false
    }
  )
}

function mountConfluence(): void {
  const probed = probeConfluencePage()
  if (!probed.pageId) return
  mountConfluenceButton(probed, () => {
    void startRun()
  })
}

async function mountBridge(settings: Settings): Promise<void> {
  const bridge = createBridge({
    fetchBytes: (src) =>
      sendMessage<BridgeBytes>({ type: "bridge:fetch", src }),
    postToPage: (kind, detail) => {
      window.postMessage(
        { __cikiImageBridge: "to-page", kind, detail },
        window.location.origin
      )
    },
    isAllowedSrc: (src) => isSameOrigin(src, settings.confluenceUrl),
    onFailure: (message, src) => {
      void sendMessage({ type: "bridge:status", ok: false, message, src })
    },
    onSuccess: (src) => {
      void sendMessage({ type: "bridge:status", ok: true, message: "", src })
    }
  })

  // 顺序要紧：先挂监听，再让后台往 MAIN world 注入中继并广播 plugin-hello，
  // 否则页面立刻回的 hello 会落空。
  bridge.start()
  const installed = await sendMessage<{ installed: boolean }>({
    type: "bridge:install"
  })
  if (!installed.ok) {
    console.warn(`[ciki] 事件桥中继注入失败：${installed.message}`)
  }
}

async function main(): Promise<void> {
  const host = window as unknown as Record<string, unknown>
  if (host[GUARD]) return
  host[GUARD] = true

  listenForPopup()

  const settings = await loadSettings()
  const here = window.location.origin
  const confluenceOrigin = originOf(settings.confluenceUrl)
  const cikiOrigin = originOf(settings.cikiUrl)

  if (confluenceOrigin && confluenceOrigin === here) {
    mountConfluence()
  } else if (cikiOrigin && cikiOrigin === here) {
    await mountBridge(settings)
  }
}

void main()
