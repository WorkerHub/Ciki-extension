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
const BRIDGE_ERROR_KEY = "bridge-last-error"
const BRIDGE_OK_KEY = "bridge-last-ok"

function area(): chrome.storage.StorageArea {
  // 旧版 Chrome 没有 storage.session：退回 local（只影响证据留存，不影响功能）
  return chrome.storage.session ?? chrome.storage.local
}

export async function putRun(run: PreparedRun): Promise<void> {
  await area().set({ [`${RUN_PREFIX}${run.runId}`]: run })
}

export async function takeRun(runId: string): Promise<PreparedRun | null> {
  const key = `${RUN_PREFIX}${runId}`
  const stored = await area().get(key)
  const run = stored[key] as PreparedRun | undefined
  if (run) await area().remove(key)
  return run ?? null
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

export async function setBridgeStatus(status: BridgeStatus): Promise<void> {
  await area().set({
    [status.ok ? BRIDGE_OK_KEY : BRIDGE_ERROR_KEY]: status
  })
}

export async function loadBridgeStatus(): Promise<{
  error: BridgeStatus | null
  ok: BridgeStatus | null
}> {
  const stored = await area().get([BRIDGE_ERROR_KEY, BRIDGE_OK_KEY])
  return {
    error: (stored[BRIDGE_ERROR_KEY] as BridgeStatus | undefined) ?? null,
    ok: (stored[BRIDGE_OK_KEY] as BridgeStatus | undefined) ?? null
  }
}
