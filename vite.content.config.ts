import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/**
 * content script 构建：单入口 IIFE，输出到 dist/content.js。
 * 页面注入的是经典脚本（registerContentScripts / executeScript files），
 * 不能用 ESM；同时不能清空主构建产物，所以 emptyOutDir: false。
 *
 * 一个 bundle 同时服务两种场景（按 origin 分流）：
 * - Confluence 实例域：在标题旁注入「搬到 ciki」按钮；
 * - ciki 域：粘贴补抓的事件桥插件侧。
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: fileURLToPath(new URL("./src/content/index.ts", import.meta.url)),
      formats: ["iife"],
      name: "cikiContentScript",
      fileName: () => "content.js"
    }
  }
})
