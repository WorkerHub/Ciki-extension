import { describe, expect, it, vi } from "vitest"
import {
  BUTTON_ID,
  mountConfluenceButton,
  unmountConfluenceButton
} from "./confluence"
import { probeConfluencePage } from "./probe"

function page(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html"
  )
}

describe("pageId / contextPath 探测", () => {
  const location = {
    search: "",
    pathname: "/display/TEAM/Guide"
  } as Location

  it("优先 meta ajs-page-id", () => {
    const doc = page(
      '<meta name="ajs-page-id" content="42"><meta name="ajs-context-path" content="/wiki/">'
    )
    expect(probeConfluencePage(doc, location)).toMatchObject({
      pageId: "42",
      contextPath: "/wiki",
      idSource: "meta ajs-page-id"
    })
  })

  it("没有 meta 时读 URL 的 pageId 参数", () => {
    const doc = page("")
    const probed = probeConfluencePage(doc, {
      ...location,
      search: "?pageId=63444152&x=1"
    } as Location)
    expect(probed.pageId).toBe("63444152")
    expect(probed.idSource).toBe("URL pageId 参数")
  })

  it("再退到 /pages/{id} 路径", () => {
    const doc = page("")
    const probed = probeConfluencePage(doc, {
      ...location,
      pathname: "/wiki/pages/777/标题"
    } as Location)
    expect(probed.pageId).toBe("777")
  })

  it("非内容页没有 pageId", () => {
    expect(probeConfluencePage(page("<p>首页</p>"), location).pageId).toBe("")
  })
})

describe("标题旁的入口按钮", () => {
  const probed = { pageId: "42", contextPath: "", idSource: "meta ajs-page-id" }

  it("挂在标题的紧邻后面", () => {
    const doc = page('<h1 id="title-text">支付服务部署手册</h1><p>正文</p>')
    const onStart = vi.fn()
    expect(mountConfluenceButton(probed, onStart, doc)).toBe(true)
    const button = doc.getElementById(BUTTON_ID)
    expect(button?.textContent).toBe("搬到 ciki")
    expect(button?.previousElementSibling?.tagName).toBe("H1")
  })

  it("点击会触发搬运（不跳转、不冒泡）", () => {
    const doc = page('<h1 id="title-text">标题</h1>')
    const onStart = vi.fn()
    mountConfluenceButton(probed, onStart, doc)
    doc
      .getElementById(BUTTON_ID)
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      )
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("重复注入不会叠第二个按钮", () => {
    const doc = page('<h1 id="title-text">标题</h1>')
    mountConfluenceButton(probed, () => undefined, doc)
    mountConfluenceButton(probed, () => undefined, doc)
    expect(doc.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1)
  })

  it("找不到标题就退到右上角浮层", () => {
    const doc = page("<p>没有标题的内容页</p>")
    expect(mountConfluenceButton(probed, () => undefined, doc)).toBe(true)
    const button = doc.getElementById(BUTTON_ID)
    expect(button?.parentElement?.getAttribute("style")).toContain(
      "position:fixed"
    )
  })

  it("不是内容页（没有 pageId）就不挂", () => {
    const doc = page("<h1>标题</h1>")
    expect(
      mountConfluenceButton(
        { pageId: "", contextPath: "", idSource: "none" },
        () => undefined,
        doc
      )
    ).toBe(false)
    expect(doc.getElementById(BUTTON_ID)).toBeNull()
  })

  it("卸载能摘掉按钮", () => {
    const doc = page('<h1 id="title-text">标题</h1>')
    mountConfluenceButton(probed, () => undefined, doc)
    unmountConfluenceButton(doc)
    expect(doc.getElementById(BUTTON_ID)).toBeNull()
  })
})
