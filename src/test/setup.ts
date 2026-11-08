import "@testing-library/jest-dom/vitest"

// jsdom 没有 DOMParser？有的。这里只补 tiptap 在测试里可能碰到的滚动 API。
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
