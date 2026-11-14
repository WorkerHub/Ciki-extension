import { describe, expect, it } from "vitest"
import {
  applyColWidthsFromColgroup,
  parseColWidth,
  resolveColumnWidths
} from "./table-columns"

const table = (colgroup: string, rows: string) =>
  `<table><colgroup>${colgroup}</colgroup><tbody>${rows}</tbody></table>`

describe("列宽换算", () => {
  it("解析百分比与像素", () => {
    expect(parseColWidth("40%")).toEqual({ kind: "percent", value: 40 })
    expect(parseColWidth("120px")).toEqual({ kind: "px", value: 120 })
    expect(parseColWidth("auto")).toBeNull()
  })

  it("百分比按 900px 基准折算，像素原样保留并用均值补齐", () => {
    expect(resolveColumnWidths(["40%", null, "180px"])).toEqual([360, 270, 180])
  })

  it("完全没有宽度时返回 null（不动表格）", () => {
    expect(resolveColumnWidths([null, null])).toBeNull()
  })
})

describe("colgroup → 单元格 colwidth", () => {
  it("多列表格照旧写 colwidth（口径不动）", () => {
    const html = applyColWidthsFromColgroup(
      table(
        '<col width="40%"><col width="30%"><col width="30%">',
        "<tr><th>环境</th><th>配置</th><th>值</th></tr>"
      )
    )
    expect(html).toContain('colwidth="360"')
    expect(html).toContain('colwidth="270"')
  })

  it("尊重 colspan：跨列单元格拿到一段宽度", () => {
    const html = applyColWidthsFromColgroup(
      table(
        '<col width="100px"><col width="200px"><col width="300px">',
        '<tr><th colspan="3">总览</th></tr><tr><td>a</td><td>b</td><td>c</td></tr>'
      )
    )
    expect(html).toContain('colwidth="100,200,300"')
  })

  it("单列表格（76px）跳过写入：不写单元格 colwidth", () => {
    const html = applyColWidthsFromColgroup(
      table(
        '<col width="76px">',
        "<tr><td><pre><code>区域一：执行程序内存</code></pre></td></tr>"
      )
    )
    expect(html).not.toContain("colwidth")
    // colgroup 连同窄列宽一起去掉：TipTap 缺 colwidth 时会回落到 <col width>
    expect(html).not.toContain("colgroup")
  })

  it("单列表格已有的 colwidth 载具不保留", () => {
    const html = applyColWidthsFromColgroup(
      '<table><colgroup><col width="76px"></colgroup>' +
        '<tbody><tr><td colwidth="76">a</td></tr></tbody></table>'
    )
    expect(html).not.toContain("colwidth")
  })

  it("单列表格带 colspan 时按多列处理，照旧写 colwidth", () => {
    const html = applyColWidthsFromColgroup(
      table(
        '<col width="120px"><col width="240px">',
        '<tr><td colspan="2">合并两列的一行</td></tr>'
      )
    )
    expect(html).toContain('colwidth="120,240"')
  })

  it("没有 colgroup 的表格原样返回", () => {
    const source = "<table><tbody><tr><th>a</th></tr></tbody></table>"
    expect(applyColWidthsFromColgroup(source)).toBe(source)
  })
})
