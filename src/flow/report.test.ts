import { describe, expect, it } from "vitest"
import { type ImportReport, reportLines } from "./report"

/** 最小报告：只关心队列统计行的几个字段，其余给不带副作用的空值。 */
function reportWith(queue: ImportReport["queue"]): ImportReport {
  return {
    title: "图集页（12 图）",
    sourceUrl: "http://127.0.0.1:8811/pages/viewpage.action?pageId=63444153",
    pageId: "p-1",
    pageUrl: "http://127.0.0.1:8812/p/p-1",
    spaceName: "",
    conflict: "create_copy",
    images: { total: 12, uploaded: 12, failed: [] },
    attachmentLinks: [],
    droppedMacros: [],
    unknownMacros: [],
    warnings: [],
    queue
  }
}

function queueLine(report: ImportReport): string {
  const line = reportLines(report).find((item) =>
    item.startsWith("对源站的请求")
  )
  if (!line) throw new Error("报告里没有队列统计行")
  return line
}

describe("reportLines 的队列统计行", () => {
  it("只报请求次数与最短间隔，不解释节流机制", () => {
    const line = queueLine(reportWith({ count: 40, minGapMs: 201 }))
    expect(line).toBe("对源站的请求 40 次，最短间隔 201ms")
    // 括号注脚（串行、间隔随机）已删；数字是既定透明度设计，必须留着
    expect(line).not.toContain("（")
    expect(line).not.toContain("串行")
    expect(line).not.toContain("间隔随机")
  })

  it("一次请求都没记录时最短间隔落到 —", () => {
    const line = queueLine(reportWith({ count: 0, minGapMs: null }))
    expect(line).toBe("对源站的请求 0 次，最短间隔 —")
    expect(line).not.toContain("（")
  })
})
