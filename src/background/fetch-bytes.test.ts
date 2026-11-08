/**
 * 后台的附件字节出口：真发一次 HTTP，验两件在真实实例上会翻车的事——
 * 响应头带参数（`image/png;charset=UTF-8`）与反代回 `image/jpg` 时，
 * 交给 ciki 的 contentType 与 data URL 必须是白名单里的标准写法。
 */
import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { saveSettings } from "@/shared/settings"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

let server: Server
let base = ""

function area() {
  const map = new Map<string, unknown>()
  return {
    get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value)
    },
    remove: async (key: string) => {
      map.delete(key)
    }
  }
}

const listener = { addListener: () => undefined }

beforeAll(async () => {
  server = createServer((request, response) => {
    // 三个路径分别模拟：带参数的头、非标准 image/jpg、反代的 octet-stream
    const type = request.url?.includes("nonstandard")
      ? "image/jpg"
      : request.url?.includes("binary")
        ? "application/octet-stream"
        : "image/png;charset=UTF-8"
    response.writeHead(200, { "Content-Type": type })
    response.end(PNG)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`

  const storage = area()
  ;(globalThis as any).chrome = {
    storage: { local: storage, session: storage },
    runtime: {
      onInstalled: listener,
      onStartup: listener,
      onMessage: listener
    },
    permissions: { onAdded: listener, onRemoved: listener },
    scripting: { getRegisteredContentScripts: async () => [] }
  }
})

afterAll(() => {
  server?.close()
})

beforeEach(async () => {
  await saveSettings({
    confluenceUrl: base,
    cikiUrl: "http://127.0.0.1:1",
    importToken: "t",
    defaultParentId: null,
    defaultParentTitle: "",
    confluenceBase: ""
  })
})

async function fetchBytesOf(path: string) {
  const { fetchBytes } = await import("./index")
  return fetchBytes(`${base}${path}`)
}

describe("附件字节下载", () => {
  it("带 charset 的响应头被归一成 image/png", async () => {
    const result = await fetchBytesOf("/download/attachments/1/diagram.png")
    expect(result.contentType).toBe("image/png")
    expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true)
    expect(result.filename).toBe("diagram.png")
    expect(result.byteLength).toBe(PNG.byteLength)
  }, 20_000)

  it("image/jpg 归到 image/jpeg（ciki 只认后者）", async () => {
    const result = await fetchBytesOf("/download/nonstandard/photo.jpg")
    expect(result.contentType).toBe("image/jpeg")
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true)
  }, 20_000)

  it("octet-stream 时按扩展名兜底", async () => {
    const result = await fetchBytesOf("/download/binary/shot.webp")
    expect(result.contentType).toBe("image/webp")
    expect(result.dataUrl.startsWith("data:image/webp;base64,")).toBe(true)
  }, 20_000)

  it("不属于实例的地址拒绝下载（绝不拿用户会话去取任意 URL）", async () => {
    const { fetchBytes } = await import("./index")
    await expect(fetchBytes("https://evil.example.com/a.png")).rejects.toThrow(
      /不属于已配置的源站/
    )
  }, 20_000)
})
