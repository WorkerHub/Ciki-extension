/**
 * 站外图床的下载出口：权限、状态码、类型、超时四条分支，
 * 外加「绝不带浏览器会话」——请求必须是 `credentials: "omit"`。
 */
import { describe, expect, it } from "vitest"
import { fetchExternalBytes } from "./external-image"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)
const URL_OK = "https://cdn.example.com/pic/flow.png"

function fakeFetch(response: Response, seen: RequestInit[] = []) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    seen.push(init)
    return response
  }
}

const allowAll = async () => true

async function failureOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) =>
      error as { code?: string; message?: string; status?: number }
  )
}

describe("站外图下载", () => {
  it("没有该域名的权限就不发请求，报 HOST_PERMISSION", async () => {
    let requested = false
    const failure = await failureOf(
      fetchExternalBytes(URL_OK, {
        hasPermission: async () => false,
        fetch: async () => {
          requested = true
          throw new Error("没授权就不该发请求")
        }
      })
    )
    expect(requested).toBe(false)
    expect(failure?.code).toBe("HOST_PERMISSION")
    expect(failure?.message).toContain("cdn.example.com")
  })

  it("成功下载：不带会话、跟随重定向，类型按 ciki 白名单归一", async () => {
    const seen: RequestInit[] = []
    let askedPattern = ""
    const result = await fetchExternalBytes(URL_OK, {
      hasPermission: async (pattern) => {
        askedPattern = pattern
        return true
      },
      fetch: fakeFetch(
        new Response(PNG, {
          headers: { "Content-Type": "image/png;charset=UTF-8" }
        }),
        seen
      )
    })
    expect(askedPattern).toBe("https://cdn.example.com/*")
    expect(result.contentType).toBe("image/png")
    expect(result.filename).toBe("flow.png")
    expect(result.byteLength).toBe(PNG.byteLength)
    expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true)
    // 站外地址一律不带浏览器会话
    expect(seen[0]).toMatchObject({ credentials: "omit", redirect: "follow" })
  })

  it("403 说清是防盗链或需要登录", async () => {
    const failure = await failureOf(
      fetchExternalBytes(URL_OK, {
        hasPermission: allowAll,
        fetch: fakeFetch(new Response("blocked", { status: 403 }))
      })
    )
    expect(failure?.code).toBe("HTTP")
    expect(failure?.status).toBe(403)
    expect(failure?.message).toContain("防盗链")
  })

  it("回的是登录页（text/html）时判非图片，而不是硬塞给 ciki", async () => {
    const failure = await failureOf(
      fetchExternalBytes(URL_OK, {
        hasPermission: allowAll,
        fetch: fakeFetch(
          new Response("<!doctype html><form>请先登录</form>", {
            headers: { "Content-Type": "text/html; charset=utf-8" }
          })
        )
      })
    )
    expect(failure?.code).toBe("BAD_RESPONSE")
    expect(failure?.message).toContain("不是图片")
  })

  it("svg 之类 ciki 不收的格式逐张报原因", async () => {
    const failure = await failureOf(
      fetchExternalBytes("https://cdn.example.com/pic/logo.svg", {
        hasPermission: allowAll,
        fetch: fakeFetch(
          new Response("<svg/>", {
            headers: { "Content-Type": "image/svg+xml" }
          })
        )
      })
    )
    expect(failure?.code).toBe("BAD_RESPONSE")
    expect(failure?.message).toContain("只收")
  })

  it("超时按单张失败处理，不把整页挂死", async () => {
    const failure = await failureOf(
      fetchExternalBytes(
        URL_OK,
        {
          hasPermission: allowAll,
          fetch: (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason)
              )
            })
        },
        20
      )
    )
    expect(failure?.code).toBe("NETWORK")
    expect(failure?.message).toContain("超时")
  })

  it("非 http(s) 地址直接拒绝", async () => {
    const failure = await failureOf(
      fetchExternalBytes("ftp://cdn.example.com/pic/flow.png", {
        hasPermission: allowAll,
        fetch: fakeFetch(new Response(PNG))
      })
    )
    expect(failure?.message).toContain("http(s)")
  })
})
