import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = fileURLToPath(new URL(".", import.meta.url))

/**
 * 扩展页面构建：popup / options / confirm 三个 HTML + background（ESM）。
 * content script 必须是被页面以经典脚本形式注入的文件，所以单独走
 * vite.content.config.ts 打成 IIFE —— 这里不能一起产出。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    rollupOptions: {
      input: {
        popup: `${root}popup.html`,
        options: `${root}options.html`,
        confirm: `${root}confirm.html`,
        background: `${root}src/background/index.ts`
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
})
