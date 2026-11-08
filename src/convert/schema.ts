/**
 * 导入用的 TipTap Schema —— 镜像 Ciki 仓 web/src/editor/extensions.ts 的扩展集。
 *
 * 为什么复制一份而不是共用：两个仓库各自独立构建，没有 workspace 可依赖；
 * ciki 那边的 NodeView（代码块角标、图片占位）也不该进插件。这里只保留
 * 影响 JSON 结构的部分，节点名、属性名、解析规则逐条对齐：
 * - StarterKit 关掉 codeBlock，换成 CodeBlock（language 属性来自 language- 类）；
 * - Image 扩展两个属性 originalSrc / confluenceImg（与后端消毒白名单同名）；
 * - 颜色三件套（文字颜色/高亮/单元格底色）与 ciki 的 colors/extensions.ts 同名同形：
 *   `textStyle.color`、`highlight.color`、`tableCell/tableHeader.backgroundColor`，
 *   HTML 载具是 data 属性（data-text-color / data-color / data-cell-bg）；
 * - Table / TaskList / TaskItem / Link / Underline 与 ciki 同配置。
 *
 * 依赖版本与 ciki 同锁 2.27.3；ciki 改 schema 时这里要同步，并重跑断言。
 */
import type {
  Attributes,
  Extensions,
  GlobalAttributes,
  JSONContent
} from "@tiptap/core"
import CodeBlock from "@tiptap/extension-code-block"
import Color from "@tiptap/extension-color"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import Table from "@tiptap/extension-table"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import TableRow from "@tiptap/extension-table-row"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import TextStyle from "@tiptap/extension-text-style"
import Underline from "@tiptap/extension-underline"
import { generateJSON } from "@tiptap/html"
import StarterKit from "@tiptap/starter-kit"
import { normalizeColor } from "./color"

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

/**
 * 颜色三件套（文字颜色 / 高亮 / 单元格底色）—— 与 ciki 的
 * web/src/editor/colors/extensions.ts 同名同形：`textStyle.color`、`highlight.color`、
 * `tableCell/tableHeader.backgroundColor`。
 *
 * 约定：HTML 里颜色一律走 data 载具（`data-text-color` / `data-color` / `data-cell-bg`），
 * 值只认小写 `#rrggbb`（见 src/convert/color.ts）。原因是导入路径 `generateJSON` 走
 * zeed-dom：那边没有 CSSStyleDeclaration（`element.style` 是 undefined，原生 Color /
 * Highlight / 表格底色的 parseHTML 会直接抛错），只有普通属性三路一致。
 */

/** zeed-dom 没有 CSSStyleDeclaration：`element.style` 可能不存在，取属性时必须兜住。 */
function inlineStyle(
  element: HTMLElement,
  property: "color" | "backgroundColor"
): string | null {
  const style = (element as unknown as { style?: Record<string, string> }).style
  return style?.[property] ?? null
}

/** 文字颜色：TextStyle 的原生规则只认「带 style 的 span」，额外加一条 data 载具规则。 */
export const WikiTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      { tag: "span[data-text-color]", getAttrs: () => ({}) },
      ...(this.parent?.() ?? [])
    ]
  }
})

/** 颜色 mark（TextStyle + Color）：先读 data 载具，再退回内联样式。 */
export const WikiColor = Color.extend({
  addGlobalAttributes() {
    const groups = (this.parent?.() ?? []) as GlobalAttributes
    return groups.map((group) => {
      if (!group.types.includes("textStyle")) return group
      return {
        ...group,
        attributes: {
          ...group.attributes,
          color: {
            ...group.attributes.color,
            parseHTML: (element: HTMLElement) =>
              normalizeColor(element.getAttribute("data-text-color")) ??
              normalizeColor(inlineStyle(element, "color")),
            renderHTML: (attributes: Attributes) => {
              const color = attributes.color as string | null
              if (!color) return {}
              return { "data-text-color": color, style: `color: ${color}` }
            }
          }
        }
      }
    })
  }
})

/** 高亮：原生行为就是 `mark[data-color]`（multicolor），颜色统一归一成 `#rrggbb`。 */
export const WikiHighlight = Highlight.extend({
  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Attributes
    if (!parent.color) return parent
    return {
      ...parent,
      color: {
        ...parent.color,
        parseHTML: (element: HTMLElement) =>
          normalizeColor(element.getAttribute("data-color")) ??
          normalizeColor(inlineStyle(element, "backgroundColor"))
      }
    }
  }
})

/** 单元格底色：TipTap 的表格 schema 没有这个属性，按契约挂 `backgroundColor`。 */
function backgroundColorAttribute() {
  return {
    backgroundColor: {
      default: null,
      parseHTML: (element: HTMLElement) =>
        normalizeColor(element.getAttribute("data-cell-bg")) ??
        normalizeColor(inlineStyle(element, "backgroundColor")),
      renderHTML: (attributes: Attributes) => {
        const color = attributes.backgroundColor as string | null
        if (!color) return {}
        return { "data-cell-bg": color, style: `background-color: ${color}` }
      }
    }
  }
}

export const WikiTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute() }
  }
})

export const WikiTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute() }
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
    // 颜色三件套：文字颜色（TextStyle + Color）、高亮、单元格底色
    WikiTextStyle,
    WikiColor,
    WikiHighlight.configure({ multicolor: true }),
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
    WikiTableHeader,
    WikiTableCell,
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
