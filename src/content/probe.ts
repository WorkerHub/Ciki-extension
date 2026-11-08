/**
 * pageId / contextPath 探测 —— 从 smoke/content-probe.js 原样移植（已在目标实例验过）：
 * meta ajs-page-id → AJS.params → ?pageId= → /pages/{id}，contextPath 同理。
 */
export interface ProbedPage {
  pageId: string
  contextPath: string
  idSource: string
}

export function probeConfluencePage(
  doc: Document = document,
  loc: Location = window.location
): ProbedPage {
  let pageId = ""
  let idSource = "none"

  const meta = doc.querySelector('meta[name="ajs-page-id"]')
  const metaContent = meta?.getAttribute("content") || ""
  if (metaContent) {
    pageId = metaContent
    idSource = "meta ajs-page-id"
  }
  const ajs = (
    window as unknown as { AJS?: { params?: Record<string, unknown> } }
  ).AJS
  if (!pageId && ajs?.params?.pageId) {
    pageId = String(ajs.params.pageId)
    idSource = "AJS.params.pageId"
  }
  if (!pageId) {
    const query = /[?&]pageId=(\d+)/.exec(loc.search)
    if (query) {
      pageId = query[1]
      idSource = "URL pageId 参数"
    }
  }
  if (!pageId) {
    const path = /\/pages\/(\d+)/.exec(loc.pathname)
    if (path) {
      pageId = path[1]
      idSource = "URL /pages/{id}"
    }
  }

  let contextPath =
    doc
      .querySelector('meta[name="ajs-context-path"]')
      ?.getAttribute("content") || ""
  if (typeof ajs?.params?.contextPath === "string") {
    contextPath = ajs.params.contextPath
  }
  contextPath = contextPath.replace(/\/+$/, "")

  return { pageId, contextPath, idSource }
}
