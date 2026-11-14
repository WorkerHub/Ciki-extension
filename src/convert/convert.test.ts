import { describe, expect, it } from "vitest"
import CODE_COLLAPSED_EXPECTED from "@/test/fixtures/code-collapsed.expected.json"
import {
  CODE_COLLAPSE_STORAGE,
  COLOR_STORAGE,
  IMAGE_STORAGE,
  PLAIN_STORAGE,
  REAL_COLOR_STORAGE,
  SAMPLE_STORAGE,
  SINGLE_COLUMN_TABLE_STORAGE
} from "@/test/fixtures/storage"
import { cleanConfluenceHtml } from "./cleaner"
import { htmlToTiptapDoc } from "./schema"
import {
  type ImageOutcome,
  parseStorage,
  type RenderOptions,
  renderStorage
} from "./storage"
import { applyColWidthsFromColgroup } from "./table-columns"

interface ConvertOptions extends Partial<RenderOptions> {
  outcomes?: [number, ImageOutcome][]
}

/** 完整链路：storage → 剪贴板形态 → §5 清洗 → 列宽 → TipTap JSON。 */
function convert(storage: string, options: ConvertOptions = {}) {
  const prepared = parseStorage(storage)
  const outcomes = new Map<number, ImageOutcome>(options.outcomes ?? [])
  const rendered = renderStorage(prepared, outcomes, {
    base: options.base ?? "https://wiki.example.com/wiki",
    attachmentUrls: options.attachmentUrls
  })
  const cleaned = applyColWidthsFromColgroup(cleanConfluenceHtml(rendered.html))
  return {
    prepared,
    rendered,
    cleaned,
    doc: htmlToTiptapDoc(cleaned)
  }
}

function nodesOfType(node: unknown, type: string): any[] {
  const found: any[] = []
  const visit = (current: any) => {
    if (!current || typeof current !== "object") return
    if (current.type === type) found.push(current)
    for (const child of current.content ?? []) visit(child)
  }
  visit(node)
  return found
}

function textOfNode(node: any): string {
  if (typeof node.text === "string") return node.text
  return (node.content ?? []).map(textOfNode).join("")
}

/** 取某段文字的 marks（找不到返回空数组）。 */
function marksOfText(node: unknown, text: string): any[] {
  const found: any[] = []
  const visit = (current: any) => {
    if (!current || typeof current !== "object") return
    if (current.type === "text" && current.text === text) {
      found.push(current.marks ?? [])
    }
    for (const child of current.content ?? []) visit(child)
  }
  visit(node)
  return found
}

const UPLOADED = "/api/files/0f3c1a2b-4d5e-4f60-8a9b-0c1d2e3f4a5b.png"
/** 转存走 imports 类别：真实 ciki 现在回的就是带前缀的地址。 */
const UPLOADED_IMPORTED =
  "/api/files/imports/0f3c1a2b-4d5e-4f60-8a9b-0c1d2e3f4a5b.png"

describe("code 宏（CDATA）", () => {
  const { doc, cleaned } = convert(SAMPLE_STORAGE)

  it("两个代码块都带语言", () => {
    const blocks = nodesOfType(doc, "codeBlock")
    expect(blocks.map((block) => block.attrs?.language)).toEqual([
      "java",
      "sql"
    ])
  })

  it("CDATA 里的 < > & 逐字保留，不被当标签吃掉", () => {
    const java = nodesOfType(doc, "codeBlock")[0]
    expect(textOfNode(java)).toContain("// 条件：a < b && b > 0")
    expect(textOfNode(java)).toContain(
      'System.out.println("starting payment service")'
    )
  })

  it("没有高亮 span 残留，代码只有一段文本", () => {
    expect(cleaned).not.toMatch(/<span[^>]*class="token/)
    const java = nodesOfType(doc, "codeBlock")[0]
    expect(java.content).toHaveLength(1)
  })
})

describe("面板宏", () => {
  const { doc } = convert(SAMPLE_STORAGE)
  const quotes = nodesOfType(doc, "blockquote")

  it("info 与 warning 各成一个引用块", () => {
    expect(quotes).toHaveLength(2)
  })

  it("标签区分提示与警告", () => {
    expect(textOfNode(quotes[0])).toContain("ℹ️ 提示")
    expect(textOfNode(quotes[1])).toContain("⚠️ 警告")
  })

  it("面板正文跟着进来", () => {
    expect(textOfNode(quotes[0])).toContain("部署窗口为每周三 22:00–23:00。")
    expect(textOfNode(quotes[1])).toContain("生产部署必须双人复核。")
  })
})

describe("表格", () => {
  const { doc, cleaned } = convert(SAMPLE_STORAGE)
  const [table] = nodesOfType(doc, "table")

  it("合并单元格保留", () => {
    expect(nodesOfType(table, "tableHeader")[0].attrs).toMatchObject({
      colspan: 3,
      rowspan: 1
    })
    const cell = nodesOfType(table, "tableCell").find(
      (item) => item.attrs?.rowspan === 2
    )
    expect(cell).toBeTruthy()
  })

  it("colgroup 列宽换算成首行 colwidth", () => {
    expect(nodesOfType(table, "tableHeader")[0].attrs.colwidth).toEqual([
      360, 120, 240
    ])
  })

  it("表头与行数对得上", () => {
    expect(nodesOfType(table, "tableRow")).toHaveLength(5)
    expect(nodesOfType(table, "tableHeader")).toHaveLength(4)
    expect(cleaned).not.toMatch(/confluence(Th|Td|Table)/)
  })
})

describe("单列表格：一律全宽，不写 colwidth", () => {
  const { doc, cleaned } = convert(SINGLE_COLUMN_TABLE_STORAGE)
  const [table] = nodesOfType(doc, "table")
  const [cell] = nodesOfType(table, "tableCell")

  it("源端 76px 窄列宽不落成单元格 colwidth", () => {
    expect(cell.attrs?.colwidth ?? null).toBeNull()
  })

  it("清洗结果里没有列宽载具（colwidth / colgroup）", () => {
    expect(cleaned).not.toContain("colwidth")
    expect(cleaned).not.toContain("colgroup")
  })

  it("格内代码块与语言照旧保留", () => {
    const [block] = nodesOfType(table, "codeBlock")
    expect(block.attrs?.language).toBe("text")
    expect(textOfNode(block)).toContain("区域一：执行程序内存 5 GB")
  })
})

describe("列表与任务", () => {
  const { doc } = convert(SAMPLE_STORAGE)

  it("两层嵌套的无序列表都在", () => {
    const lists = nodesOfType(doc, "bulletList")
    expect(lists.length).toBeGreaterThanOrEqual(3)
  })

  it("有序列表保留", () => {
    expect(nodesOfType(doc, "orderedList")).toHaveLength(1)
  })

  it("任务项两项，勾选状态正确", () => {
    const items = nodesOfType(doc, "taskItem")
    expect(items.map((item) => item.attrs?.checked)).toEqual([true, false])
    expect(textOfNode(items[0])).toContain("已完成数据库备份")
  })
})

describe("图片引用", () => {
  it("上传成功的附件图写成图床地址", () => {
    const { doc } = convert(SAMPLE_STORAGE, {
      outcomes: [
        [1, { status: "uploaded", url: UPLOADED, filename: "arch.png" }]
      ]
    })
    const image = nodesOfType(doc, "image")[0]
    expect(image.attrs.src).toBe(UPLOADED)
    expect(image.attrs.confluenceImg).toBe(false)
  })

  it("图床地址带 imports/ 类别前缀时照样回填", () => {
    const { doc } = convert(SAMPLE_STORAGE, {
      outcomes: [
        [
          1,
          {
            status: "uploaded",
            url: UPLOADED_IMPORTED,
            filename: "arch.png"
          }
        ]
      ]
    })
    const image = nodesOfType(doc, "image")[0]
    expect(image.attrs.src).toBe(UPLOADED_IMPORTED)
    expect(image.attrs.originalSrc).toBeNull()
    expect(image.attrs.confluenceImg).toBe(false)
  })

  it("站外图下载失败时保留原地址并打未转存标记", () => {
    const { doc } = convert(SAMPLE_STORAGE, {
      outcomes: [
        [
          2,
          {
            status: "failed",
            filename: "flow.png",
            downloadUrl: "https://example.com/pic/flow.png",
            reason: "HTTP 403（多半是防盗链或需要登录）"
          }
        ]
      ]
    })
    const image = nodesOfType(doc, "image").find(
      (item) => item.attrs?.originalSrc
    )
    expect(image?.attrs.originalSrc).toBe("https://example.com/pic/flow.png")
    expect(image?.attrs.confluenceImg).toBe(true)
    expect(image?.attrs.src).toBeNull()
  })

  it("下载失败的图留原链接占位，正文不中断", () => {
    const { doc } = convert(IMAGE_STORAGE, {
      outcomes: [
        [
          0,
          {
            status: "failed",
            filename: "a.png",
            downloadUrl: "https://wiki.example.com/wiki/download/a.png",
            reason: "HTTP 404"
          }
        ]
      ]
    })
    const image = nodesOfType(doc, "image")[0]
    expect(image.attrs.originalSrc).toBe(
      "https://wiki.example.com/wiki/download/a.png"
    )
    expect(image.attrs.confluenceImg).toBe(true)
  })

  it("附件清单里没有的图，至少留一行文件名", () => {
    const { doc } = convert(IMAGE_STORAGE, {
      outcomes: [
        [0, { status: "failed", filename: "a.png", reason: "没有该附件" }]
      ]
    })
    expect(JSON.stringify(doc)).toContain("🖼️ 图片未转存：a.png")
  })

  it("drawio 宏按附件图处理", () => {
    const { doc, prepared } = convert(SAMPLE_STORAGE, {
      outcomes: [[0, { status: "uploaded", url: UPLOADED, filename: "架构图" }]]
    })
    expect(prepared.refs[0]).toMatchObject({
      kind: "drawio",
      filename: "架构图"
    })
    expect(nodesOfType(doc, "image")[0].attrs.src).toBe(UPLOADED)
  })

  it("三个引用按文档顺序编号", () => {
    const { prepared } = convert(SAMPLE_STORAGE)
    expect(prepared.refs.map((ref) => ref.kind)).toEqual([
      "drawio",
      "attachment",
      "external"
    ])
  })
})

describe("宏与链接", () => {
  it("导航宏被丢弃，并在报告里留名", () => {
    const { rendered } = convert(SAMPLE_STORAGE)
    expect(rendered.droppedMacros).toEqual(["toc", "children"])
  })

  it("自闭合的导航宏不吞掉后面的正文", () => {
    const { doc } = convert(SAMPLE_STORAGE)
    expect(JSON.stringify(doc)).toContain("参考资料")
  })

  it("expand 平铺：标题保留为加粗行", () => {
    const { doc } = convert(SAMPLE_STORAGE)
    expect(JSON.stringify(doc)).toContain("回滚步骤")
    expect(JSON.stringify(doc)).toContain("回滚优先于排查。")
  })

  it("status 行内宏只留文字", () => {
    const { doc } = convert(SAMPLE_STORAGE)
    expect(JSON.stringify(doc)).toContain("当前状态：DONE")
  })

  it("页面互链按原站地址保留（v1 不重写）", () => {
    const { doc } = convert(SAMPLE_STORAGE)
    const json = JSON.stringify(doc)
    expect(json).toContain(
      "https://wiki.example.com/wiki/pages/viewpage.action?pageId=63444152"
    )
    expect(json).toContain("支付服务概览")
  })

  it("非图片附件保留原链接并记进报告", () => {
    const { rendered, doc } = convert(SAMPLE_STORAGE, {
      attachmentUrls: {
        "runbook.pdf":
          "https://wiki.example.com/wiki/download/attachments/1/runbook.pdf"
      }
    })
    expect(rendered.attachmentLinks).toEqual([
      {
        filename: "runbook.pdf",
        url: "https://wiki.example.com/wiki/download/attachments/1/runbook.pdf"
      }
    ])
    expect(JSON.stringify(doc)).toContain("部署 Runbook")
  })
})

describe("边角", () => {
  it("没有宏的普通正文照样转", () => {
    const { doc } = convert(PLAIN_STORAGE)
    expect(JSON.stringify(doc)).toContain("只有一段话。")
  })

  it("空正文得到空文档，不抛错", () => {
    const { doc } = convert("<p></p>")
    expect(doc.type).toBe("doc")
    expect(doc.content ?? []).toEqual([])
  })

  it("图片两侧不会留空段落", () => {
    const { doc } = convert(IMAGE_STORAGE, {
      outcomes: [
        [0, { status: "uploaded", url: UPLOADED, filename: "a.png" }],
        [1, { status: "uploaded", url: UPLOADED, filename: "b.png" }]
      ]
    })
    const paragraphs = nodesOfType(doc, "paragraph")
    expect(paragraphs.every((item) => (item.content ?? []).length > 0)).toBe(
      true
    )
  })
})

/**
 * 颜色批次（与 Ciki 主单 #23 冻结的契约同一口径）：
 * 文字颜色 → `textStyle` mark 的 `color`；高亮 → `highlight` mark 的 `color`；
 * 单元格底色 → `tableCell`/`tableHeader` 的 `backgroundColor`；值一律 `#rrggbb`。
 */
describe("颜色：storage 内联样式 → 契约 JSON", () => {
  const { doc, cleaned } = convert(COLOR_STORAGE)

  it("文字颜色：rgb() 归一成 #rrggbb 的 textStyle mark", () => {
    expect(marksOfText(doc, "红色警告")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#de350b" } }
    ])
  })

  it("文字颜色：大写 hex 归一成小写", () => {
    expect(marksOfText(doc, "绿色加粗")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#1f845a" } }
    ])
  })

  it("文字颜色：老式 <font color> 与段落级颜色都转成 textStyle", () => {
    expect(marksOfText(doc, "老式 font 颜色")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#0052cc" } }
    ])
    expect(marksOfText(doc, "段落级颜色")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#0052cc" } }
    ])
  })

  it("高亮：span 的 background-color 变成带色 highlight mark（含短写 hex）", () => {
    expect(marksOfText(doc, "黄色高亮")[0]).toEqual([
      { type: "highlight", attrs: { color: "#ffe58f" } }
    ])
    expect(marksOfText(doc, "短写高亮")[0]).toEqual([
      { type: "highlight", attrs: { color: "#ff0000" } }
    ])
  })

  it("归一不出来的颜色不产出 mark，文字照旧保留", () => {
    // 相邻无标记的文字会被 ProseMirror 并成一个 text 节点，按片段找
    const nodes: any[] = []
    const visit = (current: any) => {
      if (!current || typeof current !== "object") return
      if (
        current.type === "text" &&
        String(current.text).includes("没法归一的行内颜色")
      ) {
        nodes.push(current)
      }
      for (const child of current.content ?? []) visit(child)
    }
    visit(doc)
    expect(nodes.map((node) => node.marks ?? [])).toEqual([[]])
  })

  it("单元格底色：表头/单元格的 background-color 落到 backgroundColor", () => {
    const table = nodesOfType(doc, "table")[0]
    expect(
      nodesOfType(table, "tableHeader").map(
        (cell) => cell.attrs.backgroundColor
      )
    ).toEqual(["#f4f5f7", "#deebff"])
    expect(
      nodesOfType(table, "tableCell").map((cell) => cell.attrs.backgroundColor)
    ).toEqual(["#fffae6", "#ffebe6"])
  })

  it("单元格底色：归一不出来的写法不落到 JSON（只留文字）", () => {
    const plain = convert(
      '<table><tbody><tr><td style="background-color: yellow;">格</td></tr></tbody></table>'
    )
    const cell = nodesOfType(plain.doc, "tableCell")[0]
    expect(cell.attrs.backgroundColor).toBeNull()
    expect(textOfNode(cell)).toBe("格")
  })

  it("同一个单元格的文字颜色与底色同时保留", () => {
    expect(marksOfText(doc, "3000ms")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#de350b" } }
    ])
    const cell = nodesOfType(doc, "tableCell").find(
      (item) => textOfNode(item) === "3000ms"
    )
    expect(cell?.attrs.backgroundColor).toBe("#ffebe6")
  })

  it("除颜色外的内联样式照旧剥干净（不进 HTML，也不进 JSON）", () => {
    expect(cleaned).not.toMatch(/\sstyle=/)
    const json = JSON.stringify(doc)
    expect(json).not.toContain("font-size")
    expect(json).not.toContain("fontWeight")
    expect(json).not.toContain("border")
    expect(json).not.toContain("var(--accent)")
  })

  it("颜色属性只有契约里的三个名字", () => {
    const markTypes = new Set<string>()
    const attrKeys = new Set<string>()
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return
      for (const mark of node.marks ?? []) {
        markTypes.add(mark.type)
        for (const key of Object.keys(mark.attrs ?? {})) {
          attrKeys.add(`${mark.type}.${key}`)
        }
      }
      for (const child of node.content ?? []) visit(child)
    }
    visit(doc)
    expect([...markTypes].sort()).toEqual(["highlight", "textStyle"])
    expect([...attrKeys].sort()).toEqual(["highlight.color", "textStyle.color"])
  })
})

/**
 * 真实样本回归 —— 用户 2026-11-09 提供的那页 Confluence body.storage（正文换中性占位，
 * 标签与 style 值逐字保留）。发布过的 v1.0.0 包里没有颜色能力，整页颜色被剥掉；
 * 这条断言把「真实形态 11 处文字颜色一处不少」钉死，防止以后回退。
 */
describe("真实样本：整页剪藏不丢颜色", () => {
  const { cleaned, doc } = convert(REAL_COLOR_STORAGE)

  it("红字落成 span[data-text-color=#ff0000]，内部的加粗也还在", () => {
    expect(cleaned).toContain(
      '<span data-text-color="#ff0000"><strong>占位红字</strong></span>'
    )
  })

  it("红字的 marks 是颜色 + 加粗", () => {
    expect(marksOfText(doc, "占位红字")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#ff0000" } },
      { type: "bold" }
    ])
  })

  it("全篇 data-text-color 恰好 11 次", () => {
    expect(cleaned.match(/data-text-color/g) ?? []).toHaveLength(11)
  })

  it("橙字与灰字按真实色值落库", () => {
    expect(marksOfText(doc, "占位橙字一")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#ff9900" } }
    ])
    expect(marksOfText(doc, "占位灰字段三")[0]).toEqual([
      { type: "textStyle", attrs: { color: "#333333" } }
    ])
  })

  it("第 12 处颜色（rgb(255,204,0)）包的是图，不落成文字颜色", () => {
    expect(cleaned).not.toContain('data-text-color="#ffcc00"')
  })

  it("除颜色载具外没有内联样式残留", () => {
    expect(cleaned).not.toMatch(/\sstyle=/)
  })
})

/**
 * 代码块折叠（契约：`codeBlock.attrs.collapsed` 为布尔，`null` = 未表态）。
 * 源站把代码宏设成折叠 → 导入后就是折叠；没表态的普通长代码必须显式 false，
 * 否则 ciki 阅读页的「>20 行自动折」会把源站的展开长代码误折。
 */
describe("代码块折叠：collapse 参数 → 契约 JSON", () => {
  const { doc, cleaned } = convert(CODE_COLLAPSE_STORAGE)
  const blocks = nodesOfType(doc, "codeBlock")

  it("整页 JSON 与进仓快照一致", () => {
    expect(doc).toEqual(CODE_COLLAPSED_EXPECTED)
  })

  it("四种来源落成 true / false / false / null", () => {
    expect(blocks.map((block) => block.attrs?.collapsed)).toEqual([
      true,
      false,
      false,
      null
    ])
    expect(blocks.map((block) => block.attrs?.language)).toEqual([
      "java",
      "sql",
      "bash",
      null
    ])
  })

  it("折叠块代码逐字完整（CDATA 里的 < 与 && 都在）", () => {
    const folded = textOfNode(blocks[0])
    expect(folded).toContain("public class Folded {")
    expect(folded).toContain("// 作者把这条设为折叠：a < b && b > 0")
    expect(folded).toContain('System.out.println("author collapsed");')
  })

  it("没表态的长代码仍是完整 22 行，只是被显式标成展开", () => {
    expect(textOfNode(blocks[2]).split("\n")).toHaveLength(22)
    expect(blocks[2].attrs.collapsed).toBe(false)
  })

  it("载具值不合契约时按未表态处理，脏值不进 JSON", () => {
    for (const dirty of ["True", "1", ""]) {
      const result = convert(
        `<pre data-collapsed="${dirty}"><code class="language-text">x</code></pre>`
      )
      expect(nodesOfType(result.doc, "codeBlock")[0].attrs.collapsed).toBeNull()
    }
  })

  it("清洗后的 HTML 只有三段代码宏带载具，裸 <pre> 不带", () => {
    expect(cleaned.match(/data-collapsed=/g) ?? []).toHaveLength(3)
    expect(cleaned).toContain('<pre data-collapsed="true">')
    expect(cleaned).toContain('<pre data-collapsed="false">')
  })
})
