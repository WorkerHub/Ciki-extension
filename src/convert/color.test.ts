import { describe, expect, it } from "vitest"
import { normalizeColor } from "./color"

/**
 * 颜色归一的单元断言 —— 与 Ciki 仓 web/src/editor/colors/colors.test.tsx 同一批口径
 * （契约：`#rrggbb`，归一不出来的写法一律丢弃、不猜）。
 */
describe("normalizeColor：契约形态 #rrggbb", () => {
  it("合法写法归一成小写六位", () => {
    expect(normalizeColor("#DE350B")).toBe("#de350b")
    expect(normalizeColor("#f00")).toBe("#ff0000")
    expect(normalizeColor("rgb(222, 53, 11)")).toBe("#de350b")
    expect(normalizeColor("rgba(222,53,11,1)")).toBe("#de350b")
  })

  it("逗号两侧有空白、纯空格分隔都认", () => {
    expect(normalizeColor("rgb( 222 , 53 , 11 )")).toBe("#de350b")
    expect(normalizeColor("rgb(222 53 11)")).toBe("#de350b")
    expect(normalizeColor("rgba(222 53 11 / 1)")).toBe("#de350b")
  })

  it("归一不出来的写法返回 null（不猜）", () => {
    expect(normalizeColor("red")).toBeNull()
    expect(normalizeColor("var(--accent)")).toBeNull()
    expect(normalizeColor("rgba(222,53,11,0.5)")).toBeNull()
    expect(normalizeColor("")).toBeNull()
    expect(normalizeColor(null)).toBeNull()
    expect(normalizeColor(undefined)).toBeNull()
  })

  it("超长畸形输入直接拒绝（先挡长度再匹配）", () => {
    expect(normalizeColor(`rgba(1${" ".repeat(100_000)}`)).toBeNull()
  })

  it("通道值封顶 255（不产生溢出形态）", () => {
    expect(normalizeColor("rgb(300, 53, 11)")).toBe("#ff350b")
  })
})
