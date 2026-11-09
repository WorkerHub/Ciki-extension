import type { ImportErrorCode } from "@/shared/errors"
import { toImportError } from "@/shared/errors"

/** 内容页探测结果（pageId 三级探测 + contextPath）。 */
export interface PageProbe {
  pageId: string
  contextPath: string
  pageUrl: string
  /** 页面 <title>，只用于确认小窗打开前的占位显示。 */
  documentTitle: string
}

export interface QueueSnapshotData {
  lastStartedAt: number | null
  records: { url: string; startedAt: number }[]
}

export interface FetchedBytes {
  dataUrl: string
  contentType: string
  filename: string
  byteLength: number
}

export type RequestMessage =
  /** content script / popup 请求开确认小窗。 */
  | { type: "run:prepare"; tabId?: number; probe?: PageProbe }
  | { type: "confluence:json"; url: string }
  | { type: "confluence:bytes"; url: string }
  /** 站外图床的字节下载：不带浏览器会话，只认用户为该域名授予的可选权限。 */
  | { type: "image:bytes"; url: string }
  | { type: "queue:stats" }
  | { type: "bridge:install" }
  | { type: "bridge:fetch"; src: string }
  | { type: "bridge:status"; ok: boolean; message: string; src: string }
  | { type: "settings:changed" }
  | { type: "page:start" }

export type Reply<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: ImportErrorCode
      message: string
      hint: string
      stop: boolean
      status?: number
    }

export function ok<T>(data: T): Reply<T> {
  return { ok: true, data }
}

export function fail(error: unknown): Reply<never> {
  const value = toImportError(error)
  return {
    ok: false,
    code: value.code,
    message: value.message,
    hint: value.hint,
    stop: value.stop,
    status: value.status
  }
}

/** 发消息并拿回带类型的回包；通道异常统一折成同一种失败形状。 */
export async function sendMessage<T>(
  message: RequestMessage
): Promise<Reply<T>> {
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as
      | Reply<T>
      | undefined
    return reply ?? fail(new Error("后台没有回包"))
  } catch (error) {
    return fail(error)
  }
}

/** 后台向指定标签页发消息（页面侧没装脚本时会抛错，调用方自己兜）。 */
export async function sendToTab<T>(
  tabId: number,
  message: RequestMessage
): Promise<Reply<T>> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, message)) as
      | Reply<T>
      | undefined
    return reply ?? fail(new Error("页面没有回包"))
  } catch (error) {
    return fail(error)
  }
}
