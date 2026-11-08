import { type ChildProcess, spawn } from "node:child_process"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ConfluenceQueue, summarizeQueue } from "@/background/confluence-queue"
import { ImportApi } from "@/ciki/api"
import { arrayBufferToDataUrl } from "@/shared/bytes"
import type { Reply, RequestMessage } from "@/shared/messages"
import { loadSettings, saveSettings } from "@/shared/settings"
import type { ImportJob } from "./import"
import {
  checkConflict,
  chooseSpaceId,
  executeImport,
  prepareImport,
  selectSpace
} from "./import"

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
        spaceId: "space-default",
        parentId: "p-root",
        conflict: "create_copy"
      },
      () => undefined
    )

    expect(result.pageId).toMatch(/[0-9a-f-]{36}/)
    // 接口回的是根相对路径 /p/<id>：报告与「在 ciki 打开」都要补成绝对地址
    expect(result.url).toBe(`${CIKI}/p/${result.pageId}`)
    expect(result.report.pageUrl).toBe(`${CIKI}/p/${result.pageId}`)
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
        spaceId: "space-default",
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
        spaceId: "space-default",
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

describe("空间落点（夹具 HTTP，不 mock 接口）", () => {
  it("预选上次用过的空间，父级来自该空间", async () => {
    await saveSettings({
      defaultSpaceId: "space-dev",
      defaultSpaceName: "研发空间",
      defaultParentId: null,
      defaultParentTitle: ""
    })
    const prepared = await prepareImport(job)
    expect(prepared.confirm.spaces.map((space) => space.id)).toEqual([
      "space-default",
      "space-dev"
    ])
    expect(prepared.confirm.defaultSpaceId).toBe("space-dev")
    expect(prepared.confirm.parents.map((item) => item.id)).toEqual(["p-dev"])
  }, 30_000)

  it("没记住或记住的空间不在了，回退到列表第一项（默认空间）", async () => {
    await saveSettings({ defaultSpaceId: "", defaultSpaceName: "" })
    const fresh = await prepareImport(job)
    expect(fresh.confirm.defaultSpaceId).toBe("space-default")
    expect(fresh.confirm.parents.map((item) => item.id)).toEqual([
      "p-root",
      "p-backend"
    ])

    await saveSettings({ defaultSpaceId: "space-gone" })
    const fallback = await prepareImport(job)
    expect(fallback.confirm.defaultSpaceId).toBe("space-default")
  }, 30_000)

  it("切空间重拉父级树，记住的父级不属于新空间时落顶层", async () => {
    await saveSettings({
      defaultSpaceId: "",
      defaultParentId: "p-root",
      defaultParentTitle: "团队知识库"
    })
    const prepared = await prepareImport(job)
    expect(prepared.confirm.defaultParentId).toBe("p-root")

    const switched = await selectSpace(prepared.context, "space-dev")
    expect(switched.parents.map((item) => item.id)).toEqual(["p-dev"])
    expect(switched.parentId).toBeNull()
    expect(prepared.context.parents.map((item) => item.id)).toEqual(["p-dev"])
  }, 30_000)

  it("写到选定的空间，并把空间记进设置与完成报告", async () => {
    await saveSettings({ defaultSpaceId: "", defaultSpaceName: "" })
    const prepared = await prepareImport(job)
    expect(prepared.confirm.defaultSpaceId).toBe("space-default")
    const switched = await selectSpace(prepared.context, "space-dev")
    // 换空间后重查同名页也得限定在新空间里
    await checkConflict(prepared.context, "space-dev", "研发空间里的页", null)

    const result = await executeImport(
      prepared.context,
      {
        title: "研发空间里的页",
        spaceId: "space-dev",
        parentId: switched.parentId,
        conflict: "create_copy"
      },
      () => undefined
    )
    expect(result.report.spaceName).toBe("研发空间")

    const calls = (await (await fetch(`${CIKI}/__imports`)).json()) as {
      path: string
      spaceId: string
      title: string
    }[]
    const pageCall = calls.filter((call) => call.path === "pages").at(-1)
    expect(pageCall).toMatchObject({ spaceId: "space-dev" })
    const checkCall = calls.filter((call) => call.path === "check").at(-1)
    expect(checkCall).toMatchObject({ spaceId: "space-dev" })

    const settings = await loadSettings()
    expect(settings.defaultSpaceId).toBe("space-dev")
    expect(settings.defaultSpaceName).toBe("研发空间")
  }, 60_000)

  it("选无权空间被服务端拒绕，归到 SPACE_FORBIDDEN", async () => {
    await saveSettings({ defaultSpaceId: "", defaultSpaceName: "" })
    const prepared = await prepareImport(job)
    await expect(
      selectSpace(prepared.context, "space-not-allowed")
    ).rejects.toMatchObject({ code: "SPACE_FORBIDDEN" })
    // 构造请求（绕过下拉）同样被拒
    await expect(
      new ImportApi(CIKI, TOKEN).check("构造的页", null, "space-not-allowed")
    ).rejects.toMatchObject({ code: "SPACE_FORBIDDEN", status: 403 })
  }, 30_000)
})

describe("预选空间的选择规则", () => {
  const spaces = [
    { id: "space-default", name: "默认空间" },
    { id: "space-dev", name: "研发空间" }
  ]

  it("记住的空间还在列表里就用它", () => {
    expect(chooseSpaceId("space-dev", spaces)).toBe("space-dev")
  })

  it("没记住、或记住的已不在列表里，用第一项", () => {
    expect(chooseSpaceId("", spaces)).toBe("space-default")
    expect(chooseSpaceId("space-gone", spaces)).toBe("space-default")
  })

  it("空列表回空串，不造无效空间 id", () => {
    expect(chooseSpaceId("space-default", [])).toBe("")
  })
})
