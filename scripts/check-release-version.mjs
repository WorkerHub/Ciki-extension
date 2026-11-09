#!/usr/bin/env node
/**
 * 发版版本校验：tag 必须是 vX.Y.Z，且 package.json 与 public/manifest.json 的
 * version 都要等于它。
 *
 * 清单是静态文件（public/manifest.json 会原样拷进扩展包），只改 package.json 时
 * Chrome 仍显示旧版本号，所以两处一起卡住。tag 工作流与 release 工作流都调它。
 *
 * 用法：node scripts/check-release-version.mjs v1.0.2
 */
import { readFileSync } from "node:fs"

const tag = process.argv[2] ?? ""
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag)
if (!match) {
  console.error(`::error::tag 形态不合法：${tag || "(空)"}，应为 vX.Y.Z`)
  process.exit(1)
}

const version = match[1]
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version
const manifestVersion = JSON.parse(
  readFileSync("public/manifest.json", "utf8")
).version

const mismatches = []
if (packageVersion !== version) {
  mismatches.push(`package.json=${packageVersion}`)
}
if (manifestVersion !== version) {
  mismatches.push(`public/manifest.json=${manifestVersion}`)
}
if (mismatches.length > 0) {
  console.error(
    `::error::版本与 tag 不一致：tag=${version}，${mismatches.join("，")}`
  )
  process.exit(1)
}

console.log(`版本校验通过：${version}`)
