import { type ChildProcess, spawn } from "node:child_process"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ConfluenceQueue, summarizeQueue } from "@/background/confluence-queue"
import { arrayBufferToDataUrl } from "@/shared/bytes"
import type { Reply, RequestMessage } from "@/shared/messages"
import { saveSettings } from "@/shared/settings"
import type { ImportJob } from "./import"
import { executeImport, prepareImport } from "./import"

/**
 * 端到端（代码级）：真 HTTP 打本地夹具，不 mock 接口。
 * 夹具不是真实 Confluence / ciki —— 交付汇报里必须这么写。
 */
const CONFLUENCE_PORT = 8891
const CIKI_PORT = 8892
const CONFLUENCE = `http://127.0.0.1:${CONFLUENCE_PORT}`
const CIKI = `http://127.0.0.1:${CIKI_PORT}`
const PAGE_ID = "63444152"
const TOKEN = "fixture-token"

let server: ChildProcess

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`夹具没起来：${url}`)
}

/** 只实现 flow 用到的那几个 chrome.* 面，storage 用内存。 */
function installChromeStub() {
  const store = new Map<string, unknown>()
  const area = {
    get: async (keys: string | string[] | null) => {
      const list =
        keys === null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys]
      const result: Record<string, unknown> = {}
      for (const key of list) if (store.has(key)) result[key] = store.get(key)
      return result
    },
    set: async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) store.set(key, value)
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    }
  }

  // 与后台同款的单一队列（真 fetch、真 1000ms 间隔）
  const queue = new ConfluenceQueue({
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  })

  const handle = async (message: RequestMessage): Promise<Reply<unknown>> => {
    if (message.type === "confluence:json") {
      const response = await queue.fetch(message.url, {
        headers: { Accept: "application/json" }
      })
      return { ok: true, data: { json: await response.json() } }
    }
    if (
      message.type === "confluence:bytes" ||
      message.type === "bridge:fetch"
    ) {
      const url =
        message.type === "confluence:bytes" ? message.url : message.src
      const response = await queue.fetch(url)
      const buffer = await response.arrayBuffer()
      return {
        ok: true,
        data: {
          dataUrl: arrayBufferToDataUrl(
            buffer,
            response.headers.get("content-type") || ""
          ),
          contentType: response.headers.get("content-type") || "",
          filename: new URL(url).pathname.split("/").pop() || "",
          byteLength: buffer.byteLength
        }
      }
    }
    if (message.type === "queue:stats") {
      return { ok: true, data: { snapshot: queue.snapshot() } }
    }
    return {
      ok: false,
      code: "UNEXPECTED",
      message: `未实现的夹具消息 ${message.type}`,
      hint: "",
      stop: false
    }
  }

  ;(globalThis as any).chrome = {
    storage: { local: area, session: area },
    runtime: {
      sendMessage: (message: RequestMessage) => handle(message),
      onMessage: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined }
    }
  }
  return queue
}

const job: ImportJob = {
  runId: "run-fixture",
  tabId: 1,
  probe: {
    pageId: PAGE_ID,
    contextPath: "",
    pageUrl: `${CONFLUENCE}/pages/viewpage.action?pageId=${PAGE_ID}`,
    documentTitle: "支付服务部署手册"
  }
}

let queue: ConfluenceQueue

beforeAll(async () => {
  server = spawn("node", [resolve(process.cwd(), "test/servers/index.mjs")], {
    env: {
      ...process.env,
      CONFLUENCE_PORT: String(CONFLUENCE_PORT),
      CIKI_PORT: String(CIKI_PORT),
      FIXTURE_TOKEN: TOKEN
    },
    stdio: "ignore"
  })
  await waitFor(`${CONFLUENCE}/__log`)
  await waitFor(`${CIKI}/__log`)
  queue = installChromeStub()
  await saveSettings({
    confluenceUrl: CONFLUENCE,
    cikiUrl: CIKI,
    importToken: TOKEN,
    defaultParentId: null,
    defaultParentTitle: "",
    confluenceBase: ""
  })
}, 30_000)

afterAll(() => {
  server?.kill("SIGTERM")
})

describe("整页搬运动编（夹具 HTTP，不 mock 接口）", () => {
  it("确认信息来自真实接口：标题、父级树、同名检查", async () => {
    const prepared = await prepareImport(job)
    expect(prepared.confirm.sourceTitle).toBe("支付服务部署手册")
    expect(prepared.confirm.parents.map((item) => item.id)).toEqual([
      "p-root",
      "p-backend"
    ])
    expect(prepared.confirm.conflict.exists).toBe(false)
    expect(prepared.context.prepared.refs).toHaveLength(2)
  })

  it("跑完整流程：图片转存、非图片附件留链接、导航宏丢弃、节流达标", async () => {
    const prepared = await prepareImport(job)
    expect(prepared.confirm.conflict.exists).toBe(false)
    const result = await executeImport(
      prepared.context,
      {
        title: prepared.confirm.sourceTitle,
        parentId: "p-root",
        conflict: "create_copy"
      },
      () => undefined
    )

    expect(result.pageId).toMatch(/[0-9a-f-]{36}/)
    expect(result.report.images.uploaded).toBe(1)
    expect(result.report.images.failed).toHaveLength(0)
    expect(result.report.images.external).toBe(1)
    expect(result.report.droppedMacros).toEqual(["toc"])
    expect(result.report.attachmentLinks.map((link) => link.filename)).toEqual(
      []
    )

    // 节流：这次测试的队列记录里，相邻请求间隔 ≥1000ms
    const summary = summarizeQueue(queue.snapshot())
    expect(summary.count).toBeGreaterThanOrEqual(3)
    expect(summary.minGapMs).toBeGreaterThanOrEqual(1000)

    // 再搬一次同名页：走更新路径，不新建
    const again = await prepareImport(job)
    expect(again.confirm.conflict.exists).toBe(true)
    const updated = await executeImport(
      again.context,
      {
        title: again.confirm.sourceTitle,
        parentId: "p-root",
        conflict: "update"
      },
      () => undefined
    )
    expect(updated.pageId).toBe(result.pageId)
    expect(updated.report.conflict).toBe("update")
  }, 60_000)

  it("附件图下载失败时正文不中断，报告里逐条列出", async () => {
    await fetch(`${CONFLUENCE}/__mode`, {
      method: "POST",
      body: JSON.stringify({ missingImage: true })
    })
    const prepared = await prepareImport(job)
    const missing = await executeImport(
      prepared.context,
      {
        title: "第二页（图缺）",
        parentId: null,
        conflict: "create_copy"
      },
      () => undefined
    )
    expect(missing.report.images.uploaded).toBe(0)
    expect(missing.report.images.failed).toHaveLength(1)
    expect(missing.report.images.failed[0]).toMatchObject({
      filename: "arch.png"
    })
    expect(missing.report.images.failed[0].reason).toContain("404")
    await fetch(`${CONFLUENCE}/__mode`, {
      method: "POST",
      body: JSON.stringify({ missingImage: false })
    })
  }, 60_000)

  it("令牌错时以 TOKEN_INVALID 停下，不写任何页面", async () => {
    await saveSettings({ importToken: "wrong-token" })
    await expect(prepareImport(job)).rejects.toMatchObject({
      code: "TOKEN_INVALID"
    })
    await saveSettings({ importToken: TOKEN })
  }, 30_000)
})
