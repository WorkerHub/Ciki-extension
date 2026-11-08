/**
 * 导入用的 TipTap Schema —— 镜像 Ciki 仓 web/src/editor/extensions.ts 的扩展集。
 *
 * 为什么复制一份而不是共用：两个仓库各自独立构建，没有 workspace 可依赖；
 * ciki 那边的 NodeView（代码块角标、图片占位）也不该进插件。这里只保留
 * 影响 JSON 结构的部分，节点名、属性名、解析规则逐条对齐：
 * - StarterKit 关掉 codeBlock，换成 CodeBlock（language 属性来自 language- 类）；
 * - Image 扩展两个属性 originalSrc / confluenceImg（与后端消毒白名单同名）；
 * - Table / TaskList / TaskItem / Link / Underline 与 ciki 同配置。
 *
 * 依赖版本与 ciki 同锁 2.27.3；ciki 改 schema 时这里要同步，并重跑断言。
 */
import type { Extensions, JSONContent } from "@tiptap/core"
import CodeBlock from "@tiptap/extension-code-block"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import Table from "@tiptap/extension-table"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import TableRow from "@tiptap/extension-table-row"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import Underline from "@tiptap/extension-underline"
import { generateJSON } from "@tiptap/html"
import StarterKit from "@tiptap/starter-kit"

/**
 * 与 ciki 的 WikiCodeBlock 同一个 schema（lowlight 只影响渲染，不影响 JSON）。
 * 只改语言属性的解析方式：官方的解析读 `firstElementChild.classList`，而导入时
 * HTML 走的是无浏览器 DOM 的解析器，classList 可能是空的；改读 class 属性后
 * 两边得到同一个 `language`，JSON 结构不变。
 */
export const WikiCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const code =
            (element.querySelector?.("code") as HTMLElement | null) ??
            (element.firstElementChild as HTMLElement | null) ??
            element
          const className =
            code?.getAttribute?.("class") ?? element.getAttribute("class") ?? ""
          const match = /(?:^|\s)language-([\w+#-]+)/.exec(className)
          return match ? match[1] : null
        },
        rendered: false
      }
    }
  }
})

/** 与 ciki 的 WikiImage 一致：多两个承载「未转存」标记的属性。 */
export const WikiImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      originalSrc: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-original-src"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.originalSrc
            ? { "data-original-src": attributes.originalSrc }
            : {}
      },
      confluenceImg: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.hasAttribute("data-confluence-img"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.confluenceImg ? { "data-confluence-img": "true" } : {}
      }
    }
  },
  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: "img[data-original-src]" }]
  }
})

export function createImportSchema(): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] }
    }),
    WikiCodeBlock.configure({
      defaultLanguage: null,
      languageClassPrefix: "language-"
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true
    }),
    WikiImage.configure({ allowBase64: true, inline: false }),
    Table.configure({
      resizable: false,
      renderWrapper: true
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true })
  ]
}

/** 干净 HTML → TipTap JSON（导入接口的 contentJson 就是这个结构）。 */
export function htmlToTiptapDoc(html: string): JSONContent {
  return pruneEmptyParagraphs(
    generateJSON(html, createImportSchema()) as JSONContent
  )
}

/**
 * 丢掉空段落。块级图片解析后会在两侧留一个空 paragraph，留着就是正文里的空行。
 * 文件末尾的空段落同理不要。
 */
export function pruneEmptyParagraphs(node: JSONContent): JSONContent {
  if (!node.content) return node
  const content = node.content
    .map((child) => pruneEmptyParagraphs(child))
    .filter((child) => {
      if (child.type !== "paragraph") return true
      const hasContent = (child.content ?? []).length > 0
      return hasContent
    })
  return { ...node, content }
}
