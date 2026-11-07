import { describe, expect, it } from "vitest"
import { ConfluenceQueue, MIN_GAP_MS, summarizeQueue } from "./confluence-queue"

function harness() {
  let clock = 0
  const sleeps: number[] = []
  const starts: number[] = []
  let active = 0
  let maxActive = 0
  let calls = 0

  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    },
    fetch: async () => {
      calls += 1
      starts.push(clock)
      active += 1
      maxActive = Math.max(maxActive, active)
      // 模拟网络往返：两次微任务跳转，期间不许有第二个请求进来
      await Promise.resolve()
      await Promise.resolve()
      active -= 1
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    }
  }

  return {
    deps,
    starts,
    sleeps,
    stats: () => ({ maxActive, calls })
  }
}

describe("Confluence 请求队列", () => {
  it("三次请求严格串行，零并发", async () => {
    const { deps, stats } = harness()
    const queue = new ConfluenceQueue(deps)
    await Promise.all([
      queue.fetch("https://wiki.example.com/a"),
      queue.fetch("https://wiki.example.com/b"),
      queue.fetch("https://wiki.example.com/c")
    ])
    expect(stats().maxActive).toBe(1)
    expect(stats().calls).toBe(3)
  })

  it("相邻两次请求的起始时间不短于 1000ms", async () => {
    const { deps, starts } = harness()
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    await queue.fetch("https://wiki.example.com/c")
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(MIN_GAP_MS)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(MIN_GAP_MS)
  })

  it("间隔是固定的 1000ms，不做随机化", async () => {
    const { deps, sleeps } = harness()
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    expect(sleeps).toEqual([MIN_GAP_MS])
  })

  it("服务工人重启后靠快照继续守间隔", async () => {
    const { deps, sleeps } = harness()
    const first = new ConfluenceQueue(deps)
    await first.fetch("https://wiki.example.com/a")
    const restarted = new ConfluenceQueue(deps, first.snapshot())
    await restarted.fetch("https://wiki.example.com/b")
    expect(sleeps[0]).toBe(MIN_GAP_MS)
  })

  it("429 立刻停手并抛可分类错误，不自动重试", async () => {
    const { deps } = harness()
    let calls = 0
    const queue = new ConfluenceQueue({
      ...deps,
      fetch: async () => {
        calls += 1
        return new Response("", { status: 429 })
      }
    })
    await expect(
      queue.fetch("https://wiki.example.com/a")
    ).rejects.toMatchObject({ code: "RATE_LIMITED", stop: true })
    expect(calls).toBe(1)
  })

  it("被重定向到登录页算登录失效，直接停", async () => {
    const { deps } = harness()
    const queue = new ConfluenceQueue({
      ...deps,
      fetch: async () =>
        new Response("", { status: 302, headers: { location: "/login" } })
    })
    await expect(
      queue.fetch("https://wiki.example.com/a")
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED", stop: true })
  })

  it("401 算登录失效，403 只算接口异常（页面权限问题不该叫重登）", async () => {
    const { deps } = harness()
    const unauthorized = new ConfluenceQueue({
      ...deps,
      fetch: async () => new Response("", { status: 401 })
    })
    await expect(
      unauthorized.fetch("https://wiki.example.com/a")
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" })

    const forbidden = new ConfluenceQueue({
      ...deps,
      fetch: async () => new Response("", { status: 403 })
    })
    await expect(
      forbidden.fetch("https://wiki.example.com/a")
    ).rejects.toMatchObject({ code: "HTTP", status: 403, stop: false })
  })

  it("网络异常折成 NETWORK，不把原始错误抛给界面", async () => {
    const { deps } = harness()
    const queue = new ConfluenceQueue({
      ...deps,
      fetch: async () => {
        throw new Error("Failed to fetch")
      }
    })
    await expect(
      queue.fetch("https://wiki.example.com/a")
    ).rejects.toMatchObject({ code: "NETWORK" })
  })

  it("报告用的最短间隔按记录算得出来", async () => {
    const { deps } = harness()
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    const summary = summarizeQueue(queue.snapshot())
    expect(summary.count).toBe(2)
    expect(summary.minGapMs).toBeGreaterThanOrEqual(MIN_GAP_MS)
  })
})
