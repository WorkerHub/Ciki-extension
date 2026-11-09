import { getSchema } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { createImportSchema, htmlToTiptapDoc } from "./schema"

/**
 * 导入 schema 的形状就是 `/api/import/pages` 的契约：后端按同一套扩展集
 * 校验节点 / mark / 属性名（Ciki worker/src/lib/tiptap-html.ts 的 validateAttrs），
 * 这里多一个少一个都会被 400 INVALID_CONTENT_JSON 挡下。Renovate 再 bump
 * tiptap 时，下面三组断言失败就是「schema 变了、要回 Ciki 对一遍」的信号。
 */
const schema = getSchema(createImportSchema())

function nodeAttrs(name: string): string[] {
  return Object.keys(schema.nodes[name].spec.attrs ?? {}).sort()
}

describe("导入 schema 与 ciki v3 对齐", () => {
  it("节点与 mark 集合固定，不多不少", () => {
    expect(Object.keys(schema.nodes).sort()).toEqual([
      "blockquote",
      "bulletList",
      "codeBlock",
      "doc",
      "hardBreak",
      "heading",
      "horizontalRule",
      "image",
      "listItem",
      "orderedList",
      "paragraph",
      "table",
      "tableCell",
      "tableHeader",
      "tableRow",
      "taskItem",
      "taskList",
      "text"
    ])
    expect(Object.keys(schema.marks).sort()).toEqual([
      "bold",
      "code",
      "highlight",
      "italic",
      "link",
      "strike",
      "textStyle",
      "underline"
    ])
  })

  it("v3 新增/沿用的属性都声明了（后端按同一扩展集校验属性名）", () => {
    expect(nodeAttrs("tableCell")).toEqual([
      "align",
      "backgroundColor",
      "colspan",
      "colwidth",
      "rowspan"
    ])
    expect(nodeAttrs("tableHeader")).toEqual([
      "align",
      "backgroundColor",
      "colspan",
      "colwidth",
      "rowspan"
    ])
    expect(nodeAttrs("image")).toEqual([
      "alt",
      "confluenceImg",
      "height",
      "originalSrc",
      "src",
      "title",
      "width"
    ])
    expect(Object.keys(schema.marks.link.spec.attrs ?? {}).sort()).toEqual([
      "class",
      "href",
      "rel",
      "target",
      "title"
    ])
  })

  it("颜色三件套的 JSON 形态不变", () => {
    const doc = htmlToTiptapDoc(
      '<p><span data-text-color="#de350b">红</span><mark data-color="#ffe58f">亮</mark></p>' +
        '<table><tbody><tr><td data-cell-bg="#fffae6">格</td></tr></tbody></table>'
    )
    expect(JSON.stringify(doc)).toContain('"color":"#de350b"')
    expect(JSON.stringify(doc)).toContain('"color":"#ffe58f"')
    expect(JSON.stringify(doc)).toContain('"backgroundColor":"#fffae6"')
  })
})
