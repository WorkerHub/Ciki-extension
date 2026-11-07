import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearRun,
  getRun,
  loadBridgeStatus,
  putRun,
  setBridgeStatus
} from "./run-store"

function fakeArea() {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value)
    },
    remove: async (key: string) => {
      map.delete(key)
    }
  }
}

let area: ReturnType<typeof fakeArea>

beforeEach(() => {
  area = fakeArea()
  vi.stubGlobal("chrome", { storage: { session: area } })
})

describe("一次性运行上下文", () => {
  const run = {
    runId: "r1",
    tabId: 7,
    probe: {
      pageId: "42",
      contextPath: "",
      pageUrl: "https://wiki.example.com/display/TEAM/Guide",
      documentTitle: "支付服务部署手册"
    },
    createdAt: 1
  }

  it("读一次之后还能再读（小窗重载/重试要恢复上下文）", async () => {
    await putRun(run)
    expect(await getRun("r1")).toMatchObject({ runId: "r1" })
    expect(await getRun("r1")).toMatchObject({ runId: "r1" })
  })

  it("搬运成功后才清掉", async () => {
    await putRun(run)
    await clearRun("r1")
    expect(await getRun("r1")).toBeNull()
  })

  it("上下文不存在时返回 null 而不是抛错", async () => {
    expect(await getRun("没这个")).toBeNull()
    expect(await getRun("")).toBeNull()
  })
})

describe("补抓最近状态", () => {
  const okStatus = { ok: true, message: "", at: 1, src: "a.png" }
  const failStatus = { ok: false, message: "登录已失效", at: 2, src: "b.png" }

  it("成功之后再失败，popup 看到的是失败（不被旧成功盖住）", async () => {
    await setBridgeStatus(okStatus)
    await setBridgeStatus(failStatus)
    const status = await loadBridgeStatus()
    expect(status.error?.message).toBe("登录已失效")
    expect(status.ok).toBeNull()
  })

  it("失败之后再成功，只看得到成功", async () => {
    await setBridgeStatus(failStatus)
    await setBridgeStatus(okStatus)
    const status = await loadBridgeStatus()
    expect(status.ok?.src).toBe("a.png")
    expect(status.error).toBeNull()
  })

  it("从没补抓过时两个字段都为空", async () => {
    expect(await loadBridgeStatus()).toEqual({ error: null, ok: null })
  })
})
