/**
 * Confluence 请求的唯一出口（后台服务工人里）。
 *
 * 红线（2026-11-10 用户拍板修订）：串行、零并发；相邻请求的起始间隔在 100–300ms
 * 之间随机取值；遇到 429 或重定向到登录页立刻停手，不重试硬闯；不掺掩护请求、
 * 不改 UA、不隐藏插件特征。（原「不随机化间隔」一项经用户知情拍板撤销。）
 *
 * 间隔以「上一次请求的起始时间」为基准：每次请求独立抽一个目标间隔，扣掉上一请求
 * 已经用掉的时间后补足 —— 与改动前的时序完全一致，只换时长来源，不把请求耗时
 * 叠加到间隔之外。因此相邻请求的起始间隔为 max(抽取值, 上一请求耗时)：正常情况
 * 落在 [MIN_GAP_MS, MAX_GAP_MS] 内，上一请求本身更久时就顺延到它完成。
 * 随机源可注入（QueueDeps.random），测试用确定性序列。
 *
 * 队列状态（最近一次请求时间 + 每次请求的起始时间）会落到 storage.session：
 * MV3 的服务工人随时可能被回收，重启后靠它继续守间隔，也给交付自测留证据。
 */
import { ImportError } from "@/shared/errors"

export const MIN_GAP_MS = 100
export const MAX_GAP_MS = 300
const MAX_RECORDS = 200

export interface QueueRecord {
  url: string
  startedAt: number
}

export interface QueueSnapshot {
  /** null = 这个队列还没发过请求（时间戳 0 是合法的测试时钟，不能拿 0 当哨兵）。 */
  lastStartedAt: number | null
  records: QueueRecord[]
}

export interface QueueDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** [0, 1) 的随机源：注入确定性序列给测试，生产传 Math.random。 */
  random: () => number
  onRecord?: (snapshot: QueueSnapshot) => void
}

export class ConfluenceQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private started = false
  private lastStartedAt = 0
  private records: QueueRecord[] = []
  private readonly deps: QueueDeps

  constructor(deps: QueueDeps, snapshot?: QueueSnapshot | null) {
    this.deps = deps
    if (snapshot && snapshot.lastStartedAt !== null) {
      this.started = true
      this.lastStartedAt = snapshot.lastStartedAt
      this.records = [...snapshot.records]
    }
  }

  snapshot(): QueueSnapshot {
    return {
      lastStartedAt: this.started ? this.lastStartedAt : null,
      records: [...this.records]
    }
  }

  /** 串行入口：调用方 await 的是自己那一次请求，队列本身不会并发。 */
  fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const run = this.tail.then(() => this.execute(url, init))
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** 本次请求的目标间隔：闭区间 [100, 300] 内的整数毫秒，每次独立抽取。 */
  private nextGapMs(): number {
    const span = MAX_GAP_MS - MIN_GAP_MS + 1
    const unit = Math.min(1, Math.max(0, this.deps.random()))
    return Math.min(MAX_GAP_MS, MIN_GAP_MS + Math.floor(unit * span))
  }

  private async execute(url: string, init: RequestInit): Promise<Response> {
    if (this.started) {
      const targetGap = this.nextGapMs()
      const waited = this.deps.now() - this.lastStartedAt
      if (waited < targetGap) await this.deps.sleep(targetGap - waited)
    }
    this.started = true
    this.lastStartedAt = this.deps.now()
    this.records.push({ url, startedAt: this.lastStartedAt })
    if (this.records.length > MAX_RECORDS) this.records.shift()
    this.deps.onRecord?.(this.snapshot())

    let response: Response
    try {
      response = await this.deps.fetch(url, {
        credentials: "include",
        redirect: "manual",
        ...init
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ImportError("NETWORK", message)
    }

    const redirected =
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    if (redirected) {
      throw new ImportError(
        "LOGIN_REQUIRED",
        `请求被重定向（HTTP ${response.status}），多半是登录态失效`
      )
    }
    if (response.status === 429) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") || "",
        10
      )
      throw new ImportError("RATE_LIMITED", "源站返回 429", {
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined
      })
    }
    if (response.status === 401) {
      throw new ImportError("LOGIN_REQUIRED", "HTTP 401")
    }
    if (response.status === 404) {
      throw new ImportError("NOT_FOUND", "HTTP 404", { status: 404 })
    }
    if (!response.ok) {
      throw new ImportError("HTTP", `HTTP ${response.status}`, {
        status: response.status
      })
    }
    return response
  }
}

/** 给报告用：请求次数 + 最短间隔（毫秒）。 */
export function summarizeQueue(snapshot: QueueSnapshot): {
  count: number
  minGapMs: number | null
} {
  const { records } = snapshot
  let minGapMs: number | null = null
  for (let index = 1; index < records.length; index += 1) {
    const gap = records[index].startedAt - records[index - 1].startedAt
    if (minGapMs === null || gap < minGapMs) minGapMs = gap
  }
  return { count: records.length, minGapMs }
}
