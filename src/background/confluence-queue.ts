/**
 * Confluence 请求的唯一出口（后台服务工人里）。
 *
 * §12.4 红线：串行、零并发、间隔 0.5–1.5s；遇到 429 或重定向到登录页立刻停手，
 * 不重试硬闯；不做任何拟人伪装（不改 UA、不掺掩护请求、不随机化间隔）。
 * 所以这里是固定 1000ms 间隔的单一队列 —— 整条链路上没有第二个去 concurrency 的地方。
 *
 * 队列状态（最近一次请求时间 + 每次请求的起始时间）会落到 storage.session：
 * MV3 的服务工人随时可能被回收，重启后靠它继续守间隔，也给交付自测留证据。
 */
import { ImportError } from "@/shared/errors"

export const MIN_GAP_MS = 1000
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

  private async execute(url: string, init: RequestInit): Promise<Response> {
    if (this.started) {
      const waited = this.deps.now() - this.lastStartedAt
      if (waited < MIN_GAP_MS) await this.deps.sleep(MIN_GAP_MS - waited)
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
      throw new ImportError("RATE_LIMITED", "Confluence 返回 429", {
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
