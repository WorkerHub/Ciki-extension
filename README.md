# ciki 搬运助手（Chrome MV3 插件）

把 Confluence 页面**整页**搬到 [ciki](../Ciki)：借浏览器当前的登录态只读取正文与附件原图，
在插件里转成 ciki 的 TipTap 结构，经你在确认小窗里点头后才写入。另外包含 ciki 编辑页
「粘贴补抓」的插件侧：ciki 里的标黄未转存图，可以由插件回 Confluence 取原始字节。

开发者模式加载，不上架商店。仓库里没有任何写死的域名——Confluence 实例地址与 ciki 地址
都由你在设置里填写。

## 安装与首次配置

```bash
pnpm install
pnpm build          # 产出 dist/（扩展页面 + background.js + content.js + manifest）
```

1. Chrome 打开 `chrome://extensions/`，右上角打开「开发者模式」。
2. 「加载已解压的扩展程序」→ 选本仓库的 `dist/` 目录。
3. 点插件图标 →「设置」，填三项：
   - **Confluence 实例地址**：自建版填站点根（如 `https://confluence.example.com`），
     Confluence Cloud 填到 `/wiki`；
   - **ciki 地址**（如 `https://ciki.example.com`）；
   - **导入令牌**：在 ciki 设置页生成后粘贴进来。明文只在这里存一次，存在
     `chrome.storage.local`，不随账号同步、不写日志。
4. 点「保存并测试」。Chrome 会为**这两个域名**各弹一次授权——只授权你填的域名，没有
   任何常驻的全站权限。测试会真的调一次 Confluence 只读接口与 ciki 的
   `GET /api/import/parents`，两边都通才算配好。

## 用起来

- **整页搬运**：打开要搬的 Confluence 内容页（保持已登录）→ 标题旁点「搬到 ciki」
  （找不到标题时按钮在右上角；也可以点插件图标再点「搬到 ciki」）。小窗里核对标题、选父级，
  同名时选「更新 / 另存 / 取消」，点「开始搬运」。完成页给「在 ciki 打开」与一份完成报告。
- **粘贴补抓**：在 ciki 编辑页粘贴含 Confluence 外链图的内容后，插件自动响应 ciki 的请求，
  回 Confluence 取原图字节；成功就由 ciki 在编辑器里替换成图床地址。失败时标黄保留，
  重试入口在 ciki 的图块上（插件不往页面注入任何按钮），失败原因可以在插件弹窗里看到。

## 权限

| 项                          | 用途                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `activeTab`                 | 你点插件图标时，允许操作当前标签页（注入入口按钮、打开确认窗）                                      |
| `scripting`                 | 在已授权域名上注册内容脚本、注入事件桥中继                                                          |
| `storage`                   | 存设置与导入令牌（`chrome.storage.local`）、存一次性运行上下文与节流记录（session）                 |
| `optional_host_permissions` | manifest 里只有全站通配声明，**运行时**只申请你填的 Confluence 域名与 ciki 域名；不授权就什么都不做 |

- 没有 `cookies` 权限，也不读、不存、不外传 Confluence 的 cookie 与凭据：请求只带浏览器当前
  会话，和你在同一浏览器里手动打开页面时一模一样。
- 域名授权按**你填的协议**申请（填 `http://` 就只申请 http，填 `https://` 就只申请 https）。
  随时可以在 `chrome://extensions/` 的扩展详情里撤销站点访问。

## 设计说明：为什么这样对 Confluence 请求（§12.4 红线）

- **串行、零并发、固定 1000ms 间隔**：所有 Confluence 请求都收在后台服务工人的一个队列里
  （`src/background/confluence-queue.ts`），下一次请求在上一次结束后至少 1000ms 才发出。
  间隔是固定值，**不做随机化**；队列状态落 `storage.session`，服务工人被回收后照样守间隔。
- **逐页手动**：每次搬运都由你点一下触发，没有批量队列、没有后台轮询、没有无人值守搬运。
- **遇 429 或重定向到登录页立即停手**：立刻中止整次搬运、分类报错，**不重试硬闯**，界面只给
  「关闭」；其他错误可以手动重新打开确认窗。
- **不做任何拟人伪装**：不改 UA、不掺掩护请求、不隐藏插件特征、不随机化行为。
- **图片串行**：附件图逐张下载、逐张上传，失败的那张在正文原位留「未转存」占位并进报告，
  不中断整页。
- **只读 Confluence**：插件不写、不改、不评论 Confluence 上的任何东西。

## 零硬编码域名

源码、manifest、默认配置里没有任何真实域名（占位符一律 `example.com`）。扫描命令（评审按此留痕）：

```bash
grep -rInE "https?://[A-Za-z0-9.-]+" src public test scripts README.md \
  | grep -vE "example\.(com|org)|127\.0\.0\.1|localhost"
# 预期：0 行
```

`dist/` 里第三方库自带的许可证注释（库主页网址）不算配置，交付扫描以源码与
`public/manifest.json` 为准。

## 转换口径（与 ciki 的粘贴清洗管线同源）

`src/convert/cleaner.ts`、`media.ts`、`table-columns.ts` 从 Ciki 仓 `web/src/editor/paste/` 与
`web/src/lib/` **逐字移植**，断言口径不放宽（`src/convert/cleaner.test.ts` 是同一批 36 条断言）。
转换链路是：storage XHTML →（`storage.ts` 把宏翻译成剪贴板里那种 HTML）→ §5 清洗 → 列宽换算 →
`@tiptap/html` 的 `generateJSON`（`schema.ts` 镜像 ciki 的扩展集，依赖同锁 2.27.3）。

| storage 里的东西                                 | 变成什么                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `ac:name="code"`（CDATA + language）             | `codeBlock`，`language` 属性来自 `language-` 类；CDATA 里的 `<` `>` `&` 逐字保留             |
| `info` / `note` / `warning` / `tip` 面板         | **引用块 + 加粗标签行**（`ℹ️ 提示 / 📝 注意 / ⚠️ 警告 / ✅ 提示`），与 §5 面板降级同一个形态 |
| `expand`                                         | 加粗标题行 + 平铺正文                                                                        |
| `status` 行内宏                                  | 纯文本（保留 `title` 参数的文字）                                                            |
| 表格（`th`/`colspan`/`rowspan`/`colgroup` 宽度） | `table` + `colwidth`，口径同 §5                                                              |
| `ac:task-list`                                   | `taskList` / `taskItem`（勾选状态保留）                                                      |
| `ac:image` + `ri:attachment`                     | 下载原图 → 上传 ciki → `image` 的 `src` 指向 `/api/files/…`                                  |
| `ac:image` + `ri:url`（外链图）                  | 不抓，留 `data-original-src` + `data-confluence-img`（后续可用粘贴补抓处理）                 |
| drawio 宏                                        | 按「图名 / 图名.png」找附件图，处理方式同附件图                                              |
| `toc` / `children` / `page-tree` 等导航宏        | 丢弃，报告里列名字                                                                           |
| 未知宏                                           | 解包保留正文，报告里列名字                                                                   |
| 指向同一 Confluence 的页面链接（`ac:link`）      | 保留为指向原站的链接，v1 不做互链重写                                                        |

为什么面板是引用块而不是 callout：ciki 的编辑器 schema 里没有 callout 节点（§5 清洗管线的
既有口径就是「引用块 + 标签行」），凭空造一个节点会让编辑器读不了；标签文字由转换器给
（Ciki 的清洗器按类名子串匹配，`confluence-information-macro-warning` 里含 `information`，
标签会一律落成「提示」——这是另一侧的行为，插件按正确标签生成，形态与 §5 完全一致）。

图片规则：`<ri:attachment>` 按文件名对 `child/attachment` 清单，取 `_links.download` 的**原图**；
拿到的 `Content-Type` 会先归一再交给 ciki（剥掉 `;charset=…`、`image/jpg` 归到 `image/jpeg`、
`application/octet-stream` 时按附件扩展名兜底），因为 ciki 只认 `image/png|jpeg|gif|webp` 四种写法；
抓不到或不是 ciki 收的格式（只收 png/jpg/gif/webp）就在正文原位留「未转存」占位（文件名 +
原链接）并汇总进完成报告；非图片附件一律不转存，只保留原链接与文件名。

## 与 ciki 的接口契约

导入接口一律按 Ciki 仓 `docs/api-contract.md` 的冻结契约（camelCase）：

- `GET /api/import/parents` → `[{ id, title, parentId }]`
- `POST /api/import/check` ← `{ title, parentId }` → `{ exists, pageId? }`
- `POST /api/import/files`（multipart，字段名 `file`）→ `{ url }`
- `POST /api/import/pages` ← `{ title, parentId, contentJson, conflict }` → `{ pageId, url }`

鉴权是 `Authorization: Bearer <导入令牌>`。字段只定义在 `src/ciki/api.ts` 一处；契约若变更，
先上报、再改这一处。

## 粘贴补抓的事件桥（Ciki 侧 #9 冻结）

拉取式四事件，全部在 `window` 上以 `ciki:image-bridge:` 为前缀：

| 事件           | 方向        | detail                                        |
| -------------- | ----------- | --------------------------------------------- |
| `plugin-hello` | 插件 → 页面 | 无（插件在 ciki 页就绪时广播一次）            |
| `hello`        | 页面 → 插件 | `{ sources: string[] }`（需要转存的原图地址） |
| `capture`      | 页面 → 插件 | `{ src: string }`（单张，用于重试）           |
| `captured`     | 插件 → 页面 | `{ src, dataUrl, filename, contentType }`     |

- 字节用 base64 data URL 而不是 Blob：Blob 过不了 world / 消息边界。
- 插件只抓**已配置 Confluence 实例**同源的地址；失败时不派 `captured`，标黄与「重试自动转存」
  入口由 ciki 侧保留，失败原因写进插件弹窗（只留最近一条，成功会被新的失败盖住）。
- `hello` 里重复出现的同一张图走缓存，不重复打 Confluence；`capture` 是用户点「重试自动转存」
  发起的，**必定重新抓一次**，不会被上一次的结果糊弄过去。
- 事件由 MAIN world 的中继脚本收发（isolated world 读不到页面派发事件的 `detail`），
  见 `src/content/relay.ts`。

## 本地自测

```bash
pnpm typecheck        # tsc
pnpm lint             # biome
pnpm test             # 130 条：§5 断言移植 36、转换 27、队列 9、设置 11、事件桥 10、入口/探测 10、
                      # ciki 地址补全 6、图片 MIME 归一 7、一次性上下文/补抓状态 6、字节出口 4、端到端 4
pnpm fixture          # 起本地夹具：假 Confluence :8811 + 假 ciki :8812（令牌 fixture-token）
pnpm build            # dist/
```

`pnpm fixture` 起的是**夹具**，不是真实 Confluence / ciki：假 Confluence 提供一页带宏/表格/附件图的
storage 正文，假 ciki 提供四个导入接口与一个补抓测试页（`/bridge-test`）。两边都带请求时间戳，
`GET /__log` 可核对串行与间隔。真实例验收由 QA 在真页上做，见 Ciki 侧验证单。

## 目录

```
src/background/    后台：Confluence 请求队列、内容脚本注册、事件桥中继注入
src/content/       内容脚本（单 IIFE）：入口按钮 / 事件桥插件侧 / MAIN world 中继
src/convert/       storage→剪贴板形态、§5 清洗管线移植、TipTap schema、JSON 生成
src/confluence/    正文与附件清单的读侧客户端、附件匹配
src/flow/          搬运编排、完成报告
src/ciki/          导入接口客户端（唯一的 ciki HTTP 出口）
src/pages/         popup / options / confirm 三个扩展页面（React + shadcn/ui Nova 组件）
src/shared/        设置、消息、错误分类、base64、session 存储
test/servers/      本地夹具（假 Confluence + 假 ciki）
```

## 已知边界（v1）

- 指向同一 Confluence 的页面链接保留原样，不做互链重写。
- 非图片附件不转存；外链图不在搬运时抓取（可以在 ciki 里用粘贴补抓补上）。
- 只做 Chrome（MV3），不做 Firefox / Safari。
- 每页正文 `contentJson` 超过 ciki 的 800,000 字节上限会直接拒绝（不会悄悄截断）。

## 历史

`smoke/` 是产品化之前的冒烟验证蓝本（REST + storage 路线可行性），逻辑已移植进
`src/content/probe.ts` 与 `src/background/confluence-queue.ts` 并有测试覆盖，原文件保留在
git 历史（commit `190afe7`）。
