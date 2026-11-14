import { describe, expect, it } from "vitest"
import {
  ConfluenceQueue,
  MAX_GAP_MS,
  MIN_GAP_MS,
  summarizeQueue
} from "./confluence-queue"

interface HarnessOptions {
  /** 依次喂给队列的随机值；队列抽完一轮后再从头来。 */
  randoms?: number[]
  /** 每个请求自己的耗时（毫秒），用来验「已用时间计入间隔」。 */
  networkMs?: number
}

function harness({ randoms = [0.5], networkMs = 0 }: HarnessOptions = {}) {
  let clock = 0
  let drawn = 0
  const sleeps: number[] = []
  const starts: number[] = []
  let active = 0
  let maxActive = 0
  let calls = 0

  const deps = {
    now: () => clock,
    random: () => randoms[drawn++ % randoms.length],
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
      clock += networkMs
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

/** 相邻请求的起始间隔（报告里的「间隔」就是这个口径）。 */
function gaps(starts: number[]): number[] {
  return starts.slice(1).map((startedAt, index) => startedAt - starts[index])
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

  it("首个请求不等待，之后每次请求都先等一个随机间隔", async () => {
    const { deps, sleeps } = harness({ randoms: [0.1, 0.5, 0.9] })
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    expect(sleeps).toEqual([])
    await queue.fetch("https://wiki.example.com/b")
    await queue.fetch("https://wiki.example.com/c")
    expect(sleeps).toHaveLength(2)
  })

  it("相邻请求的起始间隔全部落在 100–300ms（闭区间）内", async () => {
    const { deps, starts } = harness({ randoms: [0, 0.5, 0.999999] })
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    await queue.fetch("https://wiki.example.com/c")
    const intervals = gaps(starts)
    expect(intervals).toHaveLength(2)
    for (const gap of intervals) {
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP_MS)
      expect(gap).toBeLessThanOrEqual(MAX_GAP_MS)
    }
  })

  it("每次间隔独立抽取：不恒定，且都是整数毫秒", async () => {
    const { deps, sleeps } = harness({ randoms: [0.1, 0.9, 0.3] })
    const queue = new ConfluenceQueue(deps)
    for (const name of ["a", "b", "c", "d"]) {
      await queue.fetch(`https://wiki.example.com/${name}`)
    }
    expect(sleeps).toHaveLength(3)
    for (const ms of sleeps) {
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(MIN_GAP_MS)
      expect(ms).toBeLessThanOrEqual(MAX_GAP_MS)
    }
    expect(new Set(sleeps).size).toBe(3)
  })

  it("随机源取到两端时也不越界（100 与 300 都取得到）", async () => {
    const { deps, sleeps } = harness({ randoms: [0, 0.999999, 0, 0.999999] })
    const queue = new ConfluenceQueue(deps)
    for (const name of ["a", "b", "c", "d", "e"]) {
      await queue.fetch(`https://wiki.example.com/${name}`)
    }
    expect(Math.min(...sleeps)).toBe(MIN_GAP_MS)
    expect(Math.max(...sleeps)).toBe(MAX_GAP_MS)
  })

  it("上一请求耗时已计入间隔，不叠加到间隔之外（时序与改动前一致）", async () => {
    const { deps, starts, sleeps } = harness({
      randoms: [0.9],
      networkMs: 120
    })
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    const [interval] = gaps(starts)
    // 目标间隔 280ms，上一请求自己用掉 120ms，所以只补等 160ms
    expect(interval).toBe(280)
    expect(sleeps[0] + 120).toBe(interval)
  })

  it("服务工人重启后靠快照继续守间隔", async () => {
    const { deps, starts } = harness({ randoms: [0.5] })
    const first = new ConfluenceQueue(deps)
    await first.fetch("https://wiki.example.com/a")
    const restarted = new ConfluenceQueue(deps, first.snapshot())
    await restarted.fetch("https://wiki.example.com/b")
    const [interval] = gaps(starts)
    expect(interval).toBeGreaterThanOrEqual(MIN_GAP_MS)
    expect(interval).toBeLessThanOrEqual(MAX_GAP_MS)
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
    const { deps } = harness({ randoms: [0.2, 0.8] })
    const queue = new ConfluenceQueue(deps)
    await queue.fetch("https://wiki.example.com/a")
    await queue.fetch("https://wiki.example.com/b")
    const summary = summarizeQueue(queue.snapshot())
    expect(summary.count).toBe(2)
    expect(summary.minGapMs).toBeGreaterThanOrEqual(MIN_GAP_MS)
    expect(summary.minGapMs).toBeLessThanOrEqual(MAX_GAP_MS)
  })
})
