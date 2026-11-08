/**
 * 「搬到 ciki」入口按钮 —— 注入在 Confluence 内容页标题旁。
 * 只用内联样式，避免被 Confluence 的全局 CSS 改形；不改页面其它结构。
 */
import type { ProbedPage } from "./probe"

export const BUTTON_ID = "ciki-import-button"

const TITLE_SELECTORS = [
  "#title-text",
  "[data-testid='title-text']",
  ".page-title h1",
  "#main-content h1",
  "#content h1"
]

const BUTTON_STYLE = [
  "display:inline-flex",
  "align-items:center",
  "gap:6px",
  "margin-left:12px",
  "padding:4px 12px",
  "border:1px solid #d0d5dd",
  "border-radius:8px",
  "background:#ffffff",
  "color:#1a1a1a",
  "font:500 13px/1.4 -apple-system,'PingFang SC',sans-serif",
  "cursor:pointer",
  "vertical-align:middle",
  "box-shadow:0 1px 2px rgba(16,24,40,.06)"
].join(";")

function createButton(onStart: () => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.id = BUTTON_ID
  button.type = "button"
  button.textContent = "剪藏到 Ciki"
  button.title = "把这一页整页剪藏到 Ciki（逐页手动，不做批量）"
  button.setAttribute("style", BUTTON_STYLE)
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    onStart()
  })
  return button
}

function findTitle(doc: Document): Element | null {
  for (const selector of TITLE_SELECTORS) {
    const element = doc.querySelector(selector)
    if (element) return element
  }
  return null
}

/**
 * 挂按钮：标题旁优先；找不到标题就退到右上角浮层（仍然只在内容页）。
 * 返回 true 表示这次挂上了（重复注入不会叠加）。
 */
export function mountConfluenceButton(
  page: ProbedPage,
  onStart: () => void,
  doc: Document = document
): boolean {
  if (!page.pageId) return false
  if (doc.getElementById(BUTTON_ID)) return true

  const button = createButton(onStart)
  const title = findTitle(doc)

  if (title?.parentNode) {
    title.parentNode.insertBefore(button, title.nextSibling)
    return true
  }

  const host = doc.createElement("div")
  host.setAttribute(
    "style",
    "position:fixed;top:12px;right:12px;z-index:2147483000"
  )
  host.appendChild(button)
  doc.body.appendChild(host)
  return true
}

export function unmountConfluenceButton(doc: Document = document): void {
  doc.getElementById(BUTTON_ID)?.remove()
}
