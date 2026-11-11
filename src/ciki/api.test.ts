import { afterEach, describe, expect, it, vi } from "vitest"
import { cikiPageUrl, ImportApi } from "./api"

const CIKI = "https://ciki.example.com"

interface Call {
  url: string
  init?: RequestInit
}

/** 把 fetch 换成固定响应，同时记下每次请求的地址与 body。 */
function stubFetch(make: () => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return make()
  })
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? "{}"))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe("导入接口的空间参数（契约：space_id）", () => {
  it("整数 id（ciki 升级后）读成十进制字符串，一条都不丢", async () => {
    stubFetch(() =>
      jsonResponse([
        { id: 1, slug: "default", name: "默认空间" },
        { id: 2, slug: "dev", name: "研发空间" },
        { id: 3, slug: "bare" }
      ])
    )
    const spaces = await new ImportApi(CIKI, "t").spaces()
    expect(spaces).toEqual([
      { id: "1", name: "默认空间" },
      { id: "2", name: "研发空间" },
      { id: "3", name: "3" }
    ])
  })

  it("字符串 id（老版本 ciki）仍然照旧，name 缺失时用 id 兜底", async () => {
    stubFetch(() =>
      jsonResponse([
        { id: "space-default", name: "默认空间" },
        { id: "space-dev", name: "研发空间" },
        { id: "space-bare" }
      ])
    )
    const spaces = await new ImportApi(CIKI, "t").spaces()
    expect(spaces).toEqual([
      { id: "space-default", name: "默认空间" },
      { id: "space-dev", name: "研发空间" },
      { id: "space-bare", name: "space-bare" }
    ])
  })

  it("有条目的 id 读不出来时报结构不符，不静默丢成空列表", async () => {
    stubFetch(() =>
      jsonResponse([{ id: 1, name: "默认空间" }, { name: "没有 id" }])
    )
    await expect(new ImportApi(CIKI, "t").spaces()).rejects.toMatchObject({
      code: "BAD_RESPONSE",
      message: "/api/import/spaces 里有条目的 id 读不出来"
    })
  })

  it("0 / 负数 / 对象形式的 id 也不算数", async () => {
    for (const id of [0, -3, { value: 1 }, ""]) {
      stubFetch(() => jsonResponse([{ id, name: "坏条目" }]))
      await expect(new ImportApi(CIKI, "t").spaces()).rejects.toMatchObject({
        code: "BAD_RESPONSE"
      })
    }
  })

  it("parents() 把整数 id 与整数 parentId 都读成字符串，根页仍是 null", async () => {
    stubFetch(() =>
      jsonResponse([
        { id: 12, title: "团队知识库", parentId: null },
        { id: 13, title: "后端", parentId: 12 }
      ])
    )
    const parents = await new ImportApi(CIKI, "t").parents("1")
    expect(parents).toEqual([
      { id: "12", title: "团队知识库", parentId: null },
      { id: "13", title: "后端", parentId: "12" }
    ])
  })

  it("parents() 带空间时拼查询参数，不带时保持老地址", async () => {
    const calls = stubFetch(() => jsonResponse([]))
    const api = new ImportApi(`${CIKI}/`, "t")
    await api.parents("space-dev")
    await api.parents()
    expect(calls[0].url).toBe(`${CIKI}/api/import/parents?space_id=space-dev`)
    expect(calls[1].url).toBe(`${CIKI}/api/import/parents`)
    expect(calls[0].init?.credentials).toBe("omit")
  })

  it("check() 与 createPage() 的请求体都带 space_id", async () => {
    const calls = stubFetch(() => jsonResponse({ exists: false }))
    const api = new ImportApi(CIKI, "t")
    await api.check("标题", null, "space-dev")
    expect(calls[0].url).toBe(`${CIKI}/api/import/check`)
    expect(bodyOf(calls[0])).toEqual({
      title: "标题",
      parentId: null,
      space_id: "space-dev"
    })

    const created = stubFetch(() => jsonResponse({ pageId: "p1" }))
    await api.createPage({
      title: "标题",
      spaceId: "space-dev",
      parentId: "p-root",
      contentJson: "{}",
      conflict: "create_copy"
    })
    expect(bodyOf(created[0])).toMatchObject({
      space_id: "space-dev",
      parentId: "p-root",
      conflict: "create_copy"
    })
  })

  it("整数 id 透传：请求体仍发十进制字符串，服务端两种都收", async () => {
    const calls = stubFetch(() => jsonResponse({ exists: false }))
    await new ImportApi(CIKI, "t").check("标题", "12", "1")
    expect(bodyOf(calls[0])).toEqual({
      title: "标题",
      parentId: "12",
      space_id: "1"
    })
  })

  it("check() 把整数 pageId 读成字符串，否则同名页识别失效", async () => {
    stubFetch(() => jsonResponse({ exists: true, pageId: 42 }))
    await expect(
      new ImportApi(CIKI, "t").check("标题", null, "1")
    ).resolves.toEqual({ exists: true, pageId: "42" })
  })

  it("createPage() 把整数 pageId/url 读成字符串（服务端已写入，不能报错再去重试）", async () => {
    stubFetch(() => jsonResponse({ pageId: 7, url: "/p/7" }, 201))
    await expect(
      new ImportApi(CIKI, "t").createPage({
        title: "标题",
        spaceId: "1",
        parentId: null,
        contentJson: "{}",
        conflict: "create_copy"
      })
    ).resolves.toEqual({ pageId: "7", url: "/p/7" })
  })

  it("createPage() 真没回 pageId 时才算结构不符", async () => {
    stubFetch(() => jsonResponse({ url: "/p/7" }, 201))
    await expect(
      new ImportApi(CIKI, "t").createPage({
        title: "标题",
        spaceId: "1",
        parentId: null,
        contentJson: "{}",
        conflict: "create_copy"
      })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })

  it("403 SPACE_FORBIDDEN 走空间错误码与可操作文案", async () => {
    stubFetch(() =>
      jsonResponse({ error: "Space forbidden", code: "SPACE_FORBIDDEN" }, 403)
    )
    await expect(
      new ImportApi(CIKI, "t").check("标题", null, "space-secret")
    ).rejects.toMatchObject({
      code: "SPACE_FORBIDDEN",
      status: 403,
      title: "没有这个空间的写入权限"
    })
  })

  it("409 SPACE_MISMATCH 归到空间不一致错误", async () => {
    stubFetch(() =>
      jsonResponse({ error: "Space mismatch", code: "SPACE_MISMATCH" }, 409)
    )
    await expect(
      new ImportApi(CIKI, "t").createPage({
        title: "标题",
        spaceId: "space-dev",
        parentId: "p-root",
        contentJson: "{}",
        conflict: "create_copy"
      })
    ).rejects.toMatchObject({
      code: "SPACE_MISMATCH",
      status: 409,
      title: "父页不在所选空间",
      hint: "关掉弹窗重新剪藏一次，让空间与父级重新读一遍。"
    })
  })

  it("409 DEFAULT_SPACE_MISSING 提示先升级数据库", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: "Default space missing", code: "DEFAULT_SPACE_MISSING" },
        409
      )
    )
    await expect(
      new ImportApi(CIKI, "t").createPage({
        title: "标题",
        spaceId: "space-default",
        parentId: null,
        contentJson: "{}",
        conflict: "create_copy"
      })
    ).rejects.toMatchObject({
      code: "DEFAULT_SPACE_MISSING",
      title: "ciki 还没完成数据库升级"
    })
  })

  it("老版本 ciki 没有 /api/import/spaces 时给升级提示，不报结构不符", async () => {
    stubFetch(() => jsonResponse({ error: "Not found" }, 404))
    await expect(new ImportApi(CIKI, "t").spaces()).rejects.toMatchObject({
      code: "HTTP",
      status: 404,
      title: "ciki 还没有空间接口"
    })
  })
})
