import { describe, expect, it } from "vitest"
import {
  baseCandidates,
  EMPTY_SETTINGS,
  isConfigured,
  isSameOrigin,
  normalizeHttpUrl,
  originOf,
  permissionPattern,
  type Settings
} from "./settings"

const settings: Settings = {
  ...EMPTY_SETTINGS,
  confluenceUrl: "https://wiki.example.com/wiki",
  cikiUrl: "http://ciki.example.com",
  importToken: "token-123"
}

describe("地址规范化", () => {
  it("去掉尾斜杠与 hash，保留 contextPath", () => {
    expect(normalizeHttpUrl("https://wiki.example.com/wiki/")).toBe(
      "https://wiki.example.com/wiki"
    )
    expect(normalizeHttpUrl(" https://wiki.example.com/ ")).toBe(
      "https://wiki.example.com"
    )
    expect(normalizeHttpUrl("https://wiki.example.com/wiki#section")).toBe(
      "https://wiki.example.com/wiki"
    )
  })

  it("只收 http(s)", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeHttpUrl("file:///etc/passwd")).toBeNull()
    expect(normalizeHttpUrl("chrome-extension://abc/popup.html")).toBeNull()
    expect(normalizeHttpUrl("wiki.example.com")).toBeNull()
    expect(normalizeHttpUrl("")).toBeNull()
  })

  it("http 与 https 各自成 origin", () => {
    expect(originOf("http://wiki.example.com/wiki")).toBe(
      "http://wiki.example.com"
    )
    expect(originOf("https://wiki.example.com")).toBe(
      "https://wiki.example.com"
    )
  })
})

describe("可选域名权限", () => {
  it("按用户填的协议拼 match pattern", () => {
    expect(permissionPattern("https://wiki.example.com/wiki")).toBe(
      "https://wiki.example.com/*"
    )
    expect(permissionPattern("http://wiki.example.com")).toBe(
      "http://wiki.example.com/*"
    )
  })

  it("非法地址不产生权限 pattern", () => {
    expect(permissionPattern("")).toBeNull()
    expect(permissionPattern("ftp://wiki.example.com")).toBeNull()
  })

  it("同源判断：协议、域名、端口都要对上", () => {
    expect(
      isSameOrigin(
        "https://wiki.example.com/download/a.png",
        settings.confluenceUrl
      )
    ).toBe(true)
    expect(
      isSameOrigin(
        "http://wiki.example.com/download/a.png",
        settings.confluenceUrl
      )
    ).toBe(false)
    expect(
      isSameOrigin("https://other.example.com/a.png", settings.confluenceUrl)
    ).toBe(false)
    expect(isSameOrigin("javascript:alert(1)", settings.confluenceUrl)).toBe(
      false
    )
  })
})

describe("基址候选", () => {
  it("页面自己报的 contextPath 排第一，学到的第二，其次是用户填的与站点根", () => {
    expect(
      baseCandidates(
        { ...settings, confluenceBase: "https://wiki.example.com/wiki" },
        "/wiki"
      )
    ).toEqual(["https://wiki.example.com/wiki", "https://wiki.example.com"])
  })

  it("没有 contextPath 时不会拼出空段", () => {
    expect(baseCandidates(settings, "")).toEqual([
      "https://wiki.example.com/wiki",
      "https://wiki.example.com"
    ])
  })

  it("候选不重复", () => {
    const list = baseCandidates(
      {
        ...settings,
        confluenceUrl: "https://wiki.example.com",
        confluenceBase: "https://wiki.example.com"
      },
      ""
    )
    expect(list).toEqual(["https://wiki.example.com"])
  })
})

describe("配置完整性", () => {
  it("三项齐全才算配置好", () => {
    expect(isConfigured(settings)).toBe(true)
    expect(isConfigured({ ...settings, importToken: "  " })).toBe(false)
    expect(isConfigured({ ...settings, cikiUrl: "" })).toBe(false)
    expect(isConfigured(EMPTY_SETTINGS)).toBe(false)
  })

  it("默认配置里没有任何域名", () => {
    expect(JSON.stringify(EMPTY_SETTINGS)).not.toMatch(/https?:\/\//)
  })
})
