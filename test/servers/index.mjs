/**
 * 本地夹具实例 —— 只给手测与联调用，**不是**真实 Confluence / ciki。
 *
 * 两个服务：
 * - :8811 假 Confluence：内容页（带 meta ajs-page-id）、REST 正文、附件清单、附件原图；
 * - :8812 假 ciki：五个导入接口（Bearer 令牌）、图床回读、补抓桥的测试页。
 *   `/api/import/spaces` 固定回两项：默认空间在前的 `space-default` 与 `space-dev`，
 *   其它空间 id 一律 403 SPACE_FORBIDDEN；`/__imports` 把收到的导入调用攒着给测试核对落点。
 *
 * 所有请求都带时间戳记在内存里，`GET /__log` 取出来就能核对「串行 + 间隔 ≥1000ms」。
 * 报告与 README 里必须写清楚：这组数字来自夹具，真实例由 QA 在真页上验。
 */

import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"

const CONFLUENCE_PORT = Number(process.env.CONFLUENCE_PORT || 8811)
const CIKI_PORT = Number(process.env.CIKI_PORT || 8812)
const TOKEN = process.env.FIXTURE_TOKEN || "fixture-token"
const PAGE_ID = "63444152"

const ICON = readFileSync(
  new URL("../../public/icons/icon-48.png", import.meta.url)
)

const STORAGE = `<h1>支付服务部署手册</h1>
<p>本文说明 <strong>支付服务</strong> 的部署步骤，行内代码 <code>payment start</code>。</p>
<h2>1. 环境准备</h2>
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">java</ac:parameter>
  <ac:plain-text-body><![CDATA[public class Demo {
  // 条件：a < b && b > 0
  public static void main(String[] args) {
    System.out.println("hi");
  }
}]]></ac:plain-text-body>
</ac:structured-macro>
<h2>2. 配置表</h2>
<table>
  <colgroup><col style="width: 40%;" /><col style="width: 120px;" /><col /></colgroup>
  <tbody>
    <tr><th colspan="3">2026 年度配置总览</th></tr>
    <tr><th>环境</th><th>配置项</th><th>值</th></tr>
    <tr><td rowspan="2">生产</td><td>超时时间</td><td><code>3000ms</code></td></tr>
    <tr><td>重试策略</td><td>最多 3 次</td></tr>
  </tbody>
</table>
<ac:task-list>
  <ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>已完成数据库备份</ac:task-body></ac:task>
  <ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>待通知值班同学</ac:task-body></ac:task>
</ac:task-list>
<ac:structured-macro ac:name="warning"><ac:rich-text-body><p>生产部署必须双人复核。</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>
<p><ac:image ac:alt="架构图"><ri:attachment ri:filename="arch.png" /></ac:image></p>
<p><ac:image ac:alt="外链图"><ri:url ri:value="https://example.com/pic/flow.png" /></ac:image></p>
<p>参考资料：<ac:link><ri:page ri:content-id="1" /><ac:plain-text-link-body><![CDATA[支付服务概览]]></ac:plain-text-link-body></ac:link></p>
`

function createLog() {
  const entries = []
  return {
    push(port, path) {
      entries.push({ port, path, at: Date.now() })
    },
    json() {
      return JSON.stringify({ entries })
    },
    reset() {
      entries.length = 0
    }
  }
}

const log = createLog()
/** 断图演练开关：POST /__mode {missingImage:true} 后附件图变 404。 */
const mode = { missingImage: false }

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  })
  res.end(body)
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  })
  res.end(html)
}

/* ------------------------------- 假 Confluence ------------------------------ */

const confluence = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CONFLUENCE_PORT}`)
  log.push("confluence", url.pathname)
  const origin = `http://127.0.0.1:${CONFLUENCE_PORT}`

  if (url.pathname === "/__log")
    return sendJson(res, 200, JSON.parse(log.json()))
  if (url.pathname === "/__reset") {
    log.reset()
    mode.missingImage = false
    return sendJson(res, 200, { ok: true })
  }
  if (url.pathname === "/__mode" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}")
    Object.assign(mode, body)
    return sendJson(res, 200, mode)
  }

  if (url.pathname === "/") {
    return sendHtml(
      res,
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
       <meta name="ajs-page-id" content="${PAGE_ID}">
       <meta name="ajs-context-path" content="">
       <title>支付服务部署手册</title></head>
       <body><div id="main-content"><h1 id="title-text">支付服务部署手册</h1>
       <p>夹具页：仅供插件手测。</p></div></body></html>`
    )
  }

  if (url.pathname === `/rest/api/content/${PAGE_ID}`) {
    return sendJson(res, 200, {
      id: PAGE_ID,
      title: "支付服务部署手册",
      body: { storage: { value: STORAGE, representation: "storage" } },
      version: { number: 3 },
      _links: {
        base: origin,
        webui: `/pages/viewpage.action?pageId=${PAGE_ID}`
      }
    })
  }

  if (url.pathname === `/rest/api/content/${PAGE_ID}/child/attachment`) {
    return sendJson(res, 200, {
      results: [
        {
          title: "arch.png",
          metadata: { mediaType: "image/png" },
          _links: {
            base: origin,
            download: `/download/attachments/${PAGE_ID}/arch.png`
          }
        },
        {
          title: "runbook.pdf",
          metadata: { mediaType: "application/pdf" },
          _links: {
            base: origin,
            download: `/download/attachments/${PAGE_ID}/runbook.pdf`
          }
        }
      ],
      _links: { base: origin }
    })
  }

  if (url.pathname === "/rest/api/content") {
    return sendJson(res, 200, { results: [], size: 0 })
  }

  if (url.pathname === `/download/attachments/${PAGE_ID}/arch.png`) {
    if (mode.missingImage) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      return res.end("missing")
    }
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": ICON.length
    })
    return res.end(ICON)
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
  res.end("not found")
})

/* --------------------------------- 假 ciki --------------------------------- */

const pages = new Map()
const files = new Map()

// 空间替身：默认空间在前（真实接口也这么排序），第二项用来验「换空间后父级跟着换」。
const SPACES = [
  { id: "space-default", name: "默认空间" },
  { id: "space-dev", name: "研发空间" }
]
const DEFAULT_SPACE_ID = "space-default"
const PARENTS_BY_SPACE = {
  "space-default": [
    { id: "p-root", title: "团队知识库", parentId: null },
    { id: "p-backend", title: "后端", parentId: "p-root" }
  ],
  "space-dev": [{ id: "p-dev", title: "研发文档", parentId: null }]
}
/** 本次进程里收到的导入调用（供测试核对落点，不透出 contentJson）。 */
const imports = []

/** 缺省与空串都落默认空间（与后端契约一致）；不认识的空间一律拒绝。 */
function resolveSpace(value) {
  const id = typeof value === "string" && value.trim() ? value.trim() : ""
  const candidate = id || DEFAULT_SPACE_ID
  return SPACES.some((space) => space.id === candidate) ? candidate : null
}

function recordImport(path, spaceId, title) {
  imports.push({ path, spaceId, title: title || "" })
}

const bridgeTestHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>补抓桥测试页（夹具）</title></head><body>
<h1>补抓桥测试页（夹具）</h1>
<p>页面扮演 ciki 编辑页：发 hello{preselectSources}，收 captured 并记在下面。</p>
<pre id="log" data-state="waiting"></pre>
<script>
  const log = document.getElementById("log");
  const lines = [];
  const render = (state) => { log.textContent = lines.join("\\n"); log.dataset.state = state; };
  render("waiting");
  window.addEventListener("ciki:image-bridge:captured", (event) => {
    const detail = event.detail || {};
    lines.push("captured " + (detail.src || "") + " " + (detail.filename || "") + " " + String(detail.dataUrl || "").slice(0, 30) + "…");
    render("captured");
    fetch("/__captured", { method: "POST", body: JSON.stringify({ ...detail, dataUrlLength: String(detail.dataUrl || "").length }) });
  });
  window.addEventListener("ciki:image-bridge:plugin-hello", () => {
    lines.push("plugin-hello");
    const sources = new URLSearchParams(location.search).getAll("src");
    if (sources.length) {
      window.dispatchEvent(new CustomEvent("ciki:image-bridge:hello", { detail: { sources } }));
    }
    render("hello-sent");
  });
</script>
</body></html>`

const ciki = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CIKI_PORT}`)
  log.push("ciki", url.pathname)

  if (url.pathname === "/__log")
    return sendJson(res, 200, JSON.parse(log.json()))
  if (url.pathname === "/__imports") return sendJson(res, 200, imports)
  if (url.pathname === "/__reset") {
    log.reset()
    pages.clear()
    imports.length = 0
    return sendJson(res, 200, { ok: true })
  }
  if (url.pathname === "/__captured") {
    const body = await readBody(req)
    console.log("[fixture] captured:", String(body).slice(0, 400))
    return sendJson(res, 200, { ok: true })
  }
  if (url.pathname === "/bridge-test") return sendHtml(res, bridgeTestHtml)

  if (url.pathname.startsWith("/api/import/")) {
    const auth = req.headers.authorization || ""
    if (auth !== `Bearer ${TOKEN}`) {
      return sendJson(res, 401, { error: "Unauthorized" })
    }
  }

  if (url.pathname === "/api/import/spaces") {
    return sendJson(res, 200, SPACES)
  }

  if (url.pathname === "/api/import/parents") {
    const spaceId = resolveSpace(url.searchParams.get("space_id"))
    recordImport("parents", spaceId || "", "")
    if (!spaceId) {
      return sendJson(res, 403, {
        error: "Space forbidden",
        code: "SPACE_FORBIDDEN"
      })
    }
    return sendJson(res, 200, PARENTS_BY_SPACE[spaceId])
  }

  if (url.pathname === "/api/import/check" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}")
    const spaceId = resolveSpace(body.space_id)
    recordImport("check", spaceId || "", body.title)
    if (!spaceId) {
      return sendJson(res, 403, {
        error: "Space forbidden",
        code: "SPACE_FORBIDDEN"
      })
    }
    const key = `${spaceId}::${body.parentId ?? "root"}::${body.title}`
    const hit = pages.get(key)
    return sendJson(
      res,
      200,
      hit ? { exists: true, pageId: hit.id } : { exists: false }
    )
  }

  if (url.pathname === "/api/import/files" && req.method === "POST") {
    const bytes = await readBody(req)
    if (!bytes.length) return sendJson(res, 400, { error: "empty" })
    const id = randomUUID()
    const url = `/api/files/${id}.png`
    files.set(id, bytes)
    return sendJson(res, 201, {
      url,
      contentType: "image/png",
      size: bytes.length
    })
  }

  if (url.pathname === "/api/import/pages" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}")
    if (!body.title || !body.contentJson) {
      return sendJson(res, 400, { error: "title/contentJson required" })
    }
    const spaceId = resolveSpace(body.space_id)
    recordImport("pages", spaceId || "", body.title)
    if (!spaceId) {
      return sendJson(res, 403, {
        error: "Space forbidden",
        code: "SPACE_FORBIDDEN"
      })
    }
    const key = `${spaceId}::${body.parentId ?? "root"}::${body.title}`
    const existing = pages.get(key)
    const id =
      existing && body.conflict === "update" ? existing.id : randomUUID()
    pages.set(key, { id, body })
    console.log(
      `[fixture] import/pages space=${spaceId} conflict=${body.conflict} bytes=${body.contentJson.length} pageId=${id}`
    )
    // 真实后端回的是根相对路径（/p/<id>），夹具也照这个口径，别把前端的补全掩盖掉
    return sendJson(res, existing && body.conflict === "update" ? 200 : 201, {
      pageId: id,
      url: `/p/${id}`
    })
  }

  if (url.pathname.startsWith("/api/files/")) {
    const id = url.pathname.replace("/api/files/", "").replace(/\.png$/, "")
    const bytes = files.get(id)
    if (!bytes) return sendJson(res, 404, { error: "not found" })
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.length
    })
    return res.end(bytes)
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
  res.end("not found")
})

confluence.listen(CONFLUENCE_PORT, "127.0.0.1", () => {
  console.log(`[fixture] 假 Confluence: http://127.0.0.1:${CONFLUENCE_PORT}/`)
})
ciki.listen(CIKI_PORT, "127.0.0.1", () => {
  console.log(`[fixture] 假 ciki: http://127.0.0.1:${CIKI_PORT}/`)
  console.log(
    `[fixture] 补抓桥测试页: http://127.0.0.1:${CIKI_PORT}/bridge-test`
  )
  console.log(`[fixture] 令牌: ${TOKEN}`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    confluence.close()
    ciki.close()
    process.exit(0)
  })
}
