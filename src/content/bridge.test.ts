import { describe, expect, it } from "vitest"
import { type BridgeDeps, createBridge } from "./bridge"

const ALLOWED = "https://wiki.example.com/download/attachments/1/a.png"

function harness(overrides: Partial<BridgeDeps> = {}) {
  const posts: { kind: string; detail: any }[] = []
  const failures: { message: string; src: string }[] = []
  const calls: string[] = []
  const deps: BridgeDeps = {
    fetchBytes: async (src) => {
      calls.push(src)
      return {
        ok: true,
        data: {
          dataUrl: "data:image/png;base64,AAAA",
          contentType: "image/png",
          filename: "a.png"
        }
      }
    },
    postToPage: (kind, detail) => posts.push({ kind, detail }),
    isAllowedSrc: (src) => src.startsWith("https://wiki.example.com/"),
    onFailure: (message, src) => failures.push({ message, src }),
    ...overrides
  }
  return { bridge: createBridge(deps), posts, failures, calls }
}

describe("补抓事件桥（插件侧）", () => {
  it("start 时先打一声 plugin-hello", () => {
    const { bridge, posts } = harness()
    bridge.start()
    expect(posts[0]?.kind).toBe("plugin-hello")
    bridge.stop()
  })

  it("hello 里的每一张都回 captured，按顺序", async () => {
    const { bridge, posts, calls } = harness()
    await bridge.handleMessage({
      __cikiImageBridge: "to-content",
      kind: "hello",
      detail: { sources: [`${ALLOWED}?v=1`, `${ALLOWED}?v=2`] }
    })
    expect(calls).toHaveLength(2)
    const captured = posts.filter((post) => post.kind === "captured")
    expect(captured).toHaveLength(2)
    expect(captured[0].detail).toMatchObject({
      src: `${ALLOWED}?v=1`,
      dataUrl: "data:image/png;base64,AAAA",
      filename: "a.png",
      contentType: "image/png"
    })
  })

  it("capture 单张也回 captured", async () => {
    const { bridge, posts } = harness()
    await bridge.handleMessage({
      __cikiImageBridge: "to-content",
      kind: "capture",
      detail: { src: ALLOWED }
    })
    expect(posts.map((post) => post.kind)).toEqual(["captured"])
  })

  it("不属于已配置实例的地址一律不抓", async () => {
    const { bridge, posts, calls, failures } = harness()
    await bridge.handleMessage({
      __cikiImageBridge: "to-content",
      kind: "capture",
      detail: { src: "https://evil.example.com/a.png" }
    })
    expect(calls).toHaveLength(0)
    expect(posts).toHaveLength(0)
    expect(failures[0]?.message).toContain("不在已配置的 Confluence 实例")
  })

  it("抓失败不回 captured（标黄与重试入口留给 ciki 侧）", async () => {
    const { bridge, posts, failures } = harness({
      fetchBytes: async () => ({
        ok: false,
        code: "LOGIN_REQUIRED",
        message: "Confluence 登录已失效",
        hint: "",
        stop: true
      })
    })
    await bridge.handleMessage({
      __cikiImageBridge: "to-content",
      kind: "capture",
      detail: { src: ALLOWED }
    })
    expect(posts).toHaveLength(0)
    expect(failures[0]?.message).toBe("Confluence 登录已失效")
  })

  it("同一张图被重复索取时走缓存，不再打 Confluence", async () => {
    const { bridge, posts, calls } = harness()
    await bridge.handleCapture(ALLOWED)
    await bridge.handleCapture(ALLOWED)
    expect(calls).toHaveLength(1)
    expect(posts.filter((post) => post.kind === "captured")).toHaveLength(2)
  })

  it("忽略自己发出去的 to-page 消息", async () => {
    const { bridge, posts, calls } = harness()
    await bridge.handleMessage({
      __cikiImageBridge: "to-page",
      kind: "captured",
      detail: { src: ALLOWED }
    })
    expect(calls).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })

  it("hello 里混着非字符串也不炸", async () => {
    const { bridge, posts } = harness()
    await bridge.handleMessage({
      __cikiImageBridge: "to-content",
      kind: "hello",
      detail: { sources: [ALLOWED, 42, null, "", "  "] }
    })
    expect(posts.filter((post) => post.kind === "captured")).toHaveLength(1)
  })

  it("stop 之后不再处理任何请求", async () => {
    const { bridge, posts, calls } = harness()
    bridge.stop()
    await bridge.handleCapture(ALLOWED)
    expect(calls).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })
})
