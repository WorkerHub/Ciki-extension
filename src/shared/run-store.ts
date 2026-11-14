/**
 * chrome.storage.session —— 内存态的中转区，浏览器关掉就没了。
 * 用它把「要搬哪一页」交给确认小窗，把节流记录交给服务工人重启后的自己。
 */
import type { QueueSnapshot } from "@/background/confluence-queue"
import type { PageProbe } from "@/shared/messages"

type StoredQueue = QueueSnapshot

export interface PreparedRun {
  runId: string
  tabId: number
  probe: PageProbe
  createdAt: number
}

const RUN_PREFIX = "run:"
const QUEUE_KEY = "confluence-queue"
const BRIDGE_KEY = "bridge-last-status"

function area(): chrome.storage.StorageArea {
  // 旧版 Chrome 没有 storage.session：退回 local（只影响证据留存，不影响功能）
  return chrome.storage.session ?? chrome.storage.local
}

export async function putRun(run: PreparedRun): Promise<void> {
  await area().set({ [`${RUN_PREFIX}${run.runId}`]: run })
}

/** 读但不删：小窗重载、或「重新打开」重试时，还要能再拿到同一份上下文。 */
export async function getRun(runId: string): Promise<PreparedRun | null> {
  if (!runId) return null
  const key = `${RUN_PREFIX}${runId}`
  const stored = await area().get(key)
  return (stored[key] as PreparedRun | undefined) ?? null
}

/** 搬运成功后才清掉这一批，避免同一批被重复触发；关窗口不清，留给重试。 */
export async function clearRun(runId: string): Promise<void> {
  if (!runId) return
  await area().remove(`${RUN_PREFIX}${runId}`)
}

export async function loadQueueSnapshot(): Promise<StoredQueue | null> {
  const stored = await area().get(QUEUE_KEY)
  return (stored[QUEUE_KEY] as StoredQueue | undefined) ?? null
}

export async function saveQueueSnapshot(snapshot: StoredQueue): Promise<void> {
  await area().set({ [QUEUE_KEY]: snapshot })
}

export interface BridgeStatus {
  ok: boolean
  message: string
  at: number
  src?: string
}

/** 只留最近一条：成功与失败共用一个键，新的状态一定盖住旧的。 */
export async function setBridgeStatus(status: BridgeStatus): Promise<void> {
  await area().set({ [BRIDGE_KEY]: status })
}

export async function loadBridgeStatus(): Promise<{
  error: BridgeStatus | null
  ok: BridgeStatus | null
}> {
  const stored = await area().get(BRIDGE_KEY)
  const latest = stored[BRIDGE_KEY] as BridgeStatus | undefined
  if (!latest) return { error: null, ok: null }
  return latest.ok ? { error: null, ok: latest } : { error: latest, ok: null }
}
