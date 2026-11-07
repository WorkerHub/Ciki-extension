import { describe, expect, it } from "vitest"
import { cikiPageUrl } from "./api"

describe("ciki 页面地址补全", () => {
  const ciki = "https://ciki.example.com"

  it("后端回的根相对路径拼到 ciki 地址上", () => {
    expect(cikiPageUrl(ciki, "/p/abc")).toBe("https://ciki.example.com/p/abc")
  })

  it("ciki 地址带尾斜杠也不出现双斜杠", () => {
    expect(cikiPageUrl("https://ciki.example.com/", "/p/abc")).toBe(
      "https://ciki.example.com/p/abc"
    )
  })

  it("没有前导斜杠的相对路径也能拼", () => {
    expect(cikiPageUrl(ciki, "p/abc")).toBe("https://ciki.example.com/p/abc")
  })

  it("绝对地址原样返回（夹具与自建反代可能回全地址）", () => {
    expect(cikiPageUrl(ciki, "http://127.0.0.1:8812/p/abc")).toBe(
      "http://127.0.0.1:8812/p/abc"
    )
  })

  it("接口没给 url 时按 pageId 兜底", () => {
    expect(cikiPageUrl(ciki, "", "abc")).toBe("https://ciki.example.com/p/abc")
    expect(cikiPageUrl(ciki, undefined, "abc")).toBe(
      "https://ciki.example.com/p/abc"
    )
  })

  it("既没 url 也没 pageId 时给空串，不造无效链接", () => {
    expect(cikiPageUrl(ciki, "", "")).toBe("")
  })
})
