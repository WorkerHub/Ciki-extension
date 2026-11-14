/**
 * Confluence storage format → §5 清洗管线认得的「剪贴板形态」HTML。
 *
 * 为什么要有这一层：插件拿到的是 storage XHTML（ac:/ri: 宏），而 Ciki 仓已经
 * 有一条跑过真实文档的剪贴板清洗管线（src/convert/cleaner.ts）。转换器只负责
 * 把宏翻译成阅读页复制时那种 HTML 形状（面板 div、syntaxhighlighter pre、
 * inline-task-list ul、附件 img…），剩下的结构归一与图片白名单全交给 §5 那段，
 * 两侧口径天然一致，也就不用再维护第二套清洗规则。
 *
 * 三个必须自己处理的地方：
 * 1. CDATA —— HTML 解析器会把 `<![CDATA[…]]>` 当注释、遇 `>` 就截断，含 `>` 的
 *    代码会碎掉。所以解析前先把 CDATA 抽成占位元素，代码宏按原文渲染。
 * 2. HTML 宏 —— 面板、expand、status、drawio、ac:link 这些没有对应的剪贴板形态，
 *    在这里就地翻译。
 * 3. 内联颜色 —— storage 里文字颜色/高亮/单元格底色是 `style="color: …"` 这种内联样式，
 *    而属性白名单默认只留结构属性。颜色相关标签的 `style` 要原样带到剪贴板形态，
 *    清洗管线的颜色步骤才能把它归一成契约载具；其余内联样式在清洗时一并剥掉。
 */
import { safeExternalUrl } from "./media"

export type ImageRefKind = "attachment" | "external" | "drawio"

export interface ImageRef {
  index: number
  kind: ImageRefKind
  /** 附件文件名 / drawio 图名 / 外链地址的最后一段。 */
  filename: string
  /** 仅 external：原始图片地址。 */
  url?: string
  /** 仅 attachment：`ri:attachment` 里 `<ri:page>` 指到的页面（引用别页附件时才有）。 */
  pageId?: string
  alt: string
}

export interface PreparedStorage {
  /** 已标注 data-ciki-img-ref 的 storage DOM。 */
  doc: Document
  root: HTMLElement
  refs: ImageRef[]
  /** CDATA 原文，按占位序号索引。 */
  blocks: string[]
}

export type ImageStatus = "uploaded" | "failed" | "skipped"

export interface ImageOutcome {
  status: ImageStatus
  /** 上传到 ciki 后拿到的图床地址。 */
  url?: string
  /** Confluence 原图下载链接（失败时留给「未转存」占位用）。 */
  downloadUrl?: string
  filename?: string
  reason?: string
}

export interface RenderOptions {
  /** 已解析出的 Confluence 基址（含 contextPath）。 */
  base: string
  /** 附件文件名 → 原图下载链接（由附件清单解析得出）。 */
  attachmentUrls?: Record<string, string>
}

export interface RenderedStorage {
  html: string
  /** 被丢弃的导航宏名（toc/children…），报告里给个数。 */
  droppedMacros: string[]
  /** 解包保留正文的未知宏名。 */
  unknownMacros: string[]
  /** 正文里以链接形式出现的非图片附件。 */
  attachmentLinks: { filename: string; url: string }[]
}

const CDATA_MARKER = "ciki-cdata"

/** 必须整块丢弃的导航类宏：留着只会变成空正文或死链。 */
const NAV_MACROS = new Set([
  "toc",
  "children",
  "page-tree",
  "pagetree",
  "recently-updated",
  "livesearch",
  "spacedirectory",
  "contentbylabel",
  "include",
  "excerpt-include",
  "excerpt",
  "contributors",
  "labels-list"
])

const DROP_TAGS = new Set([
  "script",
  "style",
  "meta",
  "link",
  "title",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "head"
])

const KEEP_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "colgroup",
  "col",
  "blockquote",
  "pre",
  "code",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "br",
  "hr",
  "a",
  "span",
  "mark",
  "font",
  "div",
  "section",
  "article",
  "figure",
  "figcaption",
  "time",
  "small"
])

/**
 * 结构属性白名单（按标签取）。注意 `pre` 不在表里：storage 里的裸 `<pre>` 不带
 * `data-collapsed`，它走契约的「未表态」分支；折叠载具只由 code 宏显式写下。
 */
const KEEP_ATTRS: Record<string, string[]> = {
  a: ["href", "title"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  col: ["style", "width"],
  // 老式 <font color="#de350b">，清洗管线把它归一成 span[data-text-color]
  font: ["color"]
}

/**
 * 可能带颜色内联样式的标签：文字颜色写在 `color`，高亮/单元格底色写在
 * `background-color`，两者都在这里原样带过；清洗管线的颜色步骤只认这两条声明，
 * 其余声明与整条 style 一起剥除，白名单不因此放宽。
 */
const STYLE_TAGS = new Set([
  "span",
  "mark",
  "font",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "code",
  "a",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "div",
  "section",
  "article",
  "figure",
  "figcaption",
  "small",
  "time",
  "td",
  "th"
])

/** 面板宏的标签 —— 与 §5 清洗管线同一个形态（引用块 + 加粗标签行）。 */
const PANEL_LABELS: Record<string, string> = {
  info: "ℹ️ 提示",
  note: "📝 注意",
  warning: "⚠️ 警告",
  tip: "✅ 提示"
}

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "table",
  "pre",
  "blockquote",
  "hr"
])

/**
 * 明确写出自闭合的 ac:/ri: 元素。
 * 这是 XML 出身的东西，但 HTML 解析器不认 `/>`：`<ac:structured-macro … />`
 * 会被当成开标签把后面的正文全吞掉（导航宏后面、图片后面整段消失）。
 */
export function closeSelfClosing(markup: string): string {
  return markup.replace(/<((?:ac|ri):[\w-]+)([^<>]*?)\/>/g, "<$1$2></$1>")
}

/** CDATA 抽出来，换成占位元素；返回替换后的 markup 与原文表。 */
export function extractCdata(source: string): {
  xml: string
  blocks: string[]
} {
  const blocks: string[] = []
  const xml = source.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_match, body: string) => {
      blocks.push(body)
      return `<${CDATA_MARKER} data-block="${blocks.length - 1}"></${CDATA_MARKER}>`
    }
  )
  return { xml, blocks }
}

function tagOf(element: Element): string {
  return element.tagName.toLowerCase()
}

function childByTag(element: Element, name: string): Element | null {
  for (const child of Array.from(element.children)) {
    if (tagOf(child) === name) return child
  }
  return null
}

/** 元素里的文本：CDATA 占位按原文取，其余按文档顺序拼。 */
function textOf(element: Element, blocks: string[]): string {
  let text = ""
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      text += node.textContent ?? ""
      continue
    }
    if (node.nodeType !== 1) continue
    const child = node as Element
    if (tagOf(child) === CDATA_MARKER) {
      const index = Number.parseInt(child.getAttribute("data-block") || "", 10)
      if (Number.isFinite(index) && blocks[index] !== undefined) {
        text += blocks[index]
        continue
      }
    }
    text += textOf(child, blocks)
  }
  return text
}

function paramValue(macro: Element, name: string, blocks: string[]): string {
  const wanted = name.toLowerCase()
  for (const child of Array.from(macro.children)) {
    if (tagOf(child) !== "ac:parameter") continue
    if ((child.getAttribute("ac:name") || "").toLowerCase() !== wanted) continue
    return textOf(child, blocks).trim()
  }
  return ""
}

function plainTextBody(macro: Element, blocks: string[]): string {
  for (const name of ["ac:plain-text-body", "ac:rich-text-body"]) {
    const body = childByTag(macro, name)
    if (body) return textOf(body, blocks)
  }
  return ""
}

function richTextBody(macro: Element): Element | null {
  return childByTag(macro, "ac:rich-text-body")
}

function parseDocument(markup: string): HTMLElement {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body><div id="__storage">${markup}</div></body></html>`,
    "text/html"
  )
  const root = doc.getElementById("__storage")
  if (!root) throw new Error("转换器：storage 正文无法解析")
  return root
}

function baseName(value: string): string {
  const cleaned = value.split(/[?#]/)[0]
  const parts = cleaned.split("/")
  return parts[parts.length - 1] || cleaned
}

/**
 * 解析 storage 正文：抽出 CDATA、给每个图片引用编号并标在 DOM 上。
 * 图片引用按文档顺序编号，下载/上传阶段用同一个编号回填结果。
 */
export function parseStorage(storage: string): PreparedStorage {
  const { xml, blocks } = extractCdata(storage)
  const root = parseDocument(closeSelfClosing(xml))
  const doc = root.ownerDocument
  const refs: ImageRef[] = []

  const annotate = (element: Element, ref: Omit<ImageRef, "index">) => {
    const index = refs.length
    refs.push({ ...ref, index })
    element.setAttribute("data-ciki-img-ref", String(index))
  }

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = tagOf(element)
    if (tag === "ac:image") {
      const attachment = childByTag(element, "ri:attachment")
      const external = childByTag(element, "ri:url")
      const alt = (
        element.getAttribute("ac:alt") ||
        element.getAttribute("ac:title") ||
        attachment?.getAttribute("ri:filename") ||
        ""
      ).trim()
      if (attachment) {
        const filename = attachment.getAttribute("ri:filename") || ""
        // 引用别页附件时 ri:attachment 里会带 `<ri:page ri:content-id>`：
        // 附件清单是按本页查的，匹配落空后要靠这个 id 合成下载地址。
        const page = childByTag(attachment, "ri:page")
        const pageId = page?.getAttribute("ri:content-id") || undefined
        annotate(element, { kind: "attachment", filename, alt, pageId })
      } else if (external) {
        const url = external.getAttribute("ri:value") || ""
        annotate(element, {
          kind: "external",
          filename: baseName(url),
          url,
          alt
        })
      } else {
        annotate(element, { kind: "attachment", filename: "", alt })
      }
      continue
    }
    if (tag === "ac:structured-macro") {
      if ((element.getAttribute("ac:name") || "").toLowerCase() !== "drawio")
        continue
      const name =
        paramValue(element, "diagramname", blocks) ||
        paramValue(element, "title", blocks) ||
        paramValue(element, "diagramdisplayname", blocks)
      annotate(element, {
        kind: "drawio",
        filename: name,
        alt: name
      })
    }
  }

  // 文档要跟着返回：后续渲染在同一个 Document 里建节点
  return { doc, root, refs, blocks }
}

interface RenderContext {
  doc: Document
  blocks: string[]
  refs: ImageRef[]
  outcomes: Map<number, ImageOutcome>
  options: RenderOptions
  droppedMacros: string[]
  unknownMacros: string[]
  attachmentLinks: { filename: string; url: string }[]
}

function createElement(context: RenderContext, tag: string): HTMLElement {
  return context.doc.createElement(tag)
}

function copyAttributes(source: Element, target: Element): void {
  const tag = tagOf(target)
  const keep = KEEP_ATTRS[tag] ?? []
  for (const name of keep) {
    const value = source.getAttribute(name)
    if (!value) continue
    if (name === "href" && !/^(https?:\/\/|\/(?!\/))/i.test(value)) continue
    if (name === "colspan" || name === "rowspan") {
      if (!/^\d+$/.test(value.trim())) continue
    }
    target.setAttribute(name, value)
  }
  if (STYLE_TAGS.has(tag)) {
    const style = source.getAttribute("style")
    if (style) target.setAttribute("style", style)
  }
}

function renderImage(
  element: Element,
  out: HTMLElement,
  context: RenderContext
) {
  const index = Number.parseInt(
    element.getAttribute("data-ciki-img-ref") || "",
    10
  )
  const ref = Number.isFinite(index) ? context.refs[index] : undefined
  const outcome = Number.isFinite(index)
    ? context.outcomes.get(index)
    : undefined
  const img = createElement(context, "img")
  const alt = (
    element.getAttribute("ac:alt") ||
    element.getAttribute("ac:title") ||
    ref?.alt ||
    outcome?.filename ||
    ""
  ).trim()
  if (alt) img.setAttribute("alt", alt)

  if (outcome?.status === "uploaded" && outcome.url) {
    img.setAttribute("src", outcome.url)
    out.appendChild(img)
    return
  }

  const original =
    outcome?.downloadUrl || (ref?.kind === "external" ? ref.url : "") || ""
  const safe = safeExternalUrl(original)
  if (safe) {
    img.setAttribute("data-original-src", safe)
    img.setAttribute("data-confluence-img", "true")
    out.appendChild(img)
    return
  }
  // 既没转存也没原链接（附件清单里没有这张图）：至少要留下文件名，不能凭空消失。
  const paragraph = createElement(context, "p")
  paragraph.textContent = `🖼️ 图片未转存：${alt || outcome?.filename || ref?.filename || "未命名"}`
  out.appendChild(paragraph)
}

function renderTaskList(
  element: Element,
  out: HTMLElement,
  context: RenderContext
) {
  const list = createElement(context, "ul")
  list.setAttribute("class", "inline-task-list")
  for (const task of Array.from(element.children)) {
    if (tagOf(task) !== "ac:task") continue
    const status = (() => {
      const node = childByTag(task, "ac:task-status")
      return (node ? textOf(node, context.blocks) : "").trim().toLowerCase()
    })()
    const item = createElement(context, "li")
    item.setAttribute(
      "data-task-status",
      status === "complete" ? "complete" : "incomplete"
    )
    if (status === "complete") item.setAttribute("class", "checked")
    const body = childByTag(task, "ac:task-body")
    if (body) renderChildren(body, item, context)
    list.appendChild(item)
  }
  out.appendChild(list)
}

function renderLink(
  element: Element,
  out: HTMLElement,
  context: RenderContext
) {
  const page = childByTag(element, "ri:page")
  const attachment = childByTag(element, "ri:attachment")
  const body = childByTag(element, "ac:link-body")
  const plainBody = childByTag(element, "ac:plain-text-link-body")

  let href = ""
  let title = ""
  if (page) {
    const id = page.getAttribute("ri:content-id") || ""
    const contentTitle = page.getAttribute("ri:content-title") || ""
    const space = page.getAttribute("ri:space-key") || ""
    if (id) {
      href = `${context.options.base}/pages/viewpage.action?pageId=${encodeURIComponent(id)}`
      title = contentTitle
    } else if (contentTitle && space) {
      href = `${context.options.base}/display/${encodeURIComponent(space)}/${encodeURIComponent(contentTitle.replace(/ /g, "+"))}`
      title = contentTitle
    }
  }
  if (attachment) {
    const filename = attachment.getAttribute("ri:filename") || ""
    const downloadUrl = context.options.attachmentUrls?.[filename] || ""
    if (downloadUrl) {
      href = downloadUrl
      context.attachmentLinks.push({ filename, url: downloadUrl })
      title = filename
    }
  }

  const text = plainBody ? textOf(plainBody, context.blocks).trim() : ""
  const fallback =
    text ||
    title ||
    (attachment ? attachment.getAttribute("ri:filename") || "" : "")
  const anchor = createElement(context, "a")
  const safeHref = /^https?:\/\//i.test(href) ? href : ""
  if (safeHref) anchor.setAttribute("href", safeHref)
  if (title) anchor.setAttribute("title", title)
  if (body) renderChildren(body, anchor, context)
  else anchor.textContent = fallback
  out.appendChild(anchor)
}

function renderMacro(
  element: Element,
  out: HTMLElement,
  context: RenderContext
) {
  const name = (element.getAttribute("ac:name") || "").toLowerCase()

  if (NAV_MACROS.has(name)) {
    context.droppedMacros.push(name)
    return
  }

  switch (name) {
    case "code": {
      const language = paramValue(element, "language", context.blocks)
      // 折叠三态（契约：codeBlock.attrs.collapsed 布尔，null = 未表态）：
      // Confluence 默认展开，所以 `collapse` 参数无论写没写都要显式落一个布尔值，
      // 不能留缺省 —— 否则 ciki 阅读页的「>20 行自动折」会把源站的长代码误折。
      const collapse = paramValue(element, "collapse", context.blocks)
      const pre = createElement(context, "pre")
      pre.setAttribute(
        "data-collapsed",
        collapse.toLowerCase() === "true" ? "true" : "false"
      )
      const code = createElement(context, "code")
      if (/^[\w+#-]+$/.test(language)) {
        code.setAttribute("class", `language-${language.toLowerCase()}`)
      }
      code.textContent = plainTextBody(element, context.blocks)
        .replace(/\u00a0/g, " ")
        .replace(/\n+$/, "")
      pre.appendChild(code)
      out.appendChild(pre)
      return
    }
    case "info":
    case "note":
    case "warning":
    case "tip": {
      // 与 §5 面板降级同一个形态：引用块 + 加粗标签行。
      // 标签在这里给（ciki 的清洗器按类名子串匹配，"confluence-information-macro-
      // warning" 里含 "information"，面板标签会一律落成「提示」）。
      const blockquote = createElement(context, "blockquote")
      const head = createElement(context, "p")
      const strong = createElement(context, "strong")
      strong.textContent = PANEL_LABELS[name]
      head.appendChild(strong)
      blockquote.appendChild(head)
      renderBodyBlocks(richTextBody(element), blockquote, context)
      out.appendChild(blockquote)
      return
    }
    case "expand": {
      const title = paramValue(element, "title", context.blocks)
      if (title) {
        const head = createElement(context, "p")
        const strong = createElement(context, "strong")
        strong.textContent = title
        head.appendChild(strong)
        out.appendChild(head)
      }
      renderBodyBlocks(richTextBody(element), out, context)
      return
    }
    case "status": {
      const title = paramValue(element, "title", context.blocks)
      if (title) out.appendChild(context.doc.createTextNode(title))
      return
    }
    case "drawio": {
      renderImage(element, out, context)
      return
    }
    default: {
      context.unknownMacros.push(name)
      const rich = richTextBody(element)
      if (rich) {
        renderChildren(rich, out, context)
        return
      }
      const text = plainTextBody(element, context.blocks).trim()
      if (text) {
        const paragraph = createElement(context, "p")
        paragraph.textContent = text
        out.appendChild(paragraph)
      }
    }
  }
}

function renderElement(
  element: Element,
  out: HTMLElement,
  context: RenderContext
) {
  const tag = tagOf(element)
  if (tag.startsWith("ri:")) return
  if (tag === CDATA_MARKER) {
    const index = Number.parseInt(element.getAttribute("data-block") || "", 10)
    if (Number.isFinite(index) && context.blocks[index] !== undefined) {
      out.appendChild(context.doc.createTextNode(context.blocks[index]))
    }
    return
  }
  if (tag === "ac:structured-macro") {
    renderMacro(element, out, context)
    return
  }
  if (tag === "ac:image") {
    renderImage(element, out, context)
    return
  }
  if (tag === "ac:task-list") {
    renderTaskList(element, out, context)
    return
  }
  if (tag === "ac:link") {
    renderLink(element, out, context)
    return
  }
  if (tag === "ac:plain-text-body") {
    const text = textOf(element, context.blocks).trim()
    if (text) {
      const paragraph = createElement(context, "p")
      paragraph.textContent = text
      out.appendChild(paragraph)
    }
    return
  }
  if (tag === "ac:parameter" || tag === "ac:macro") return
  if (DROP_TAGS.has(tag)) return
  if (
    tag === "ac:rich-text-body" ||
    tag === "ac:layout" ||
    tag === "ac:layout-section" ||
    tag === "ac:layout-cell" ||
    tag === "ac:inline-comment-marker" ||
    tag === "ac:task-body" ||
    tag === "ac:task"
  ) {
    renderChildren(element, out, context)
    return
  }
  if (tag.startsWith("ac:")) return
  if (!KEEP_TAGS.has(tag)) {
    renderChildren(element, out, context)
    return
  }

  const target = createElement(context, tag)
  copyAttributes(element, target)
  if (tag === "br" || tag === "hr" || tag === "col") {
    out.appendChild(target)
    return
  }
  renderChildren(element, target, context)
  out.appendChild(target)
}

function renderChildren(
  source: Node,
  out: HTMLElement,
  context: RenderContext
) {
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === 3) {
      out.appendChild(context.doc.createTextNode(node.textContent ?? ""))
      continue
    }
    if (node.nodeType !== 1) continue
    renderElement(node as Element, out, context)
  }
}

/** 宏正文：有块级子节点就原样落，纯行内文字包成一段 —— 否则会漏成裸文本。 */
function renderBodyBlocks(
  source: Element | null,
  out: HTMLElement,
  context: RenderContext
) {
  if (!source) return
  const temp = createElement(context, "div")
  renderChildren(source, temp, context)
  const hasBlock = Array.from(temp.children).some((child) =>
    BLOCK_TAGS.has(tagOf(child))
  )
  if (!hasBlock && (temp.textContent ?? "").trim()) {
    const paragraph = createElement(context, "p")
    while (temp.firstChild) paragraph.appendChild(temp.firstChild)
    out.appendChild(paragraph)
    return
  }
  while (temp.firstChild) out.appendChild(temp.firstChild)
}

/** 按图片结果把 storage DOM 渲染成剪贴板形态 HTML。 */
export function renderStorage(
  prepared: PreparedStorage,
  outcomes: Map<number, ImageOutcome>,
  options: RenderOptions
): RenderedStorage {
  const context: RenderContext = {
    doc: prepared.doc,
    blocks: prepared.blocks,
    refs: prepared.refs,
    outcomes,
    options,
    droppedMacros: [],
    unknownMacros: [],
    attachmentLinks: []
  }
  const out = prepared.doc.createElement("div")
  renderChildren(prepared.root, out, context)
  return {
    html: out.innerHTML.trim(),
    droppedMacros: dedupeNames(context.droppedMacros),
    unknownMacros: dedupeNames(context.unknownMacros),
    attachmentLinks: context.attachmentLinks
  }
}

function dedupeNames(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index)
}
