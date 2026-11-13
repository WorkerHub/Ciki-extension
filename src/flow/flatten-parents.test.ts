import { describe, expect, it } from "vitest"
import type { ImportParent } from "@/ciki/api"
import { flattenParents, type ParentOption } from "./import"

/** 每行都必须原样出现一次：长度相同 + id 多重集相同。 */
function expectComplete(list: ImportParent[], out: ParentOption[]): void {
  expect(out).toHaveLength(list.length)
  expect(out.map((item) => item.id).sort()).toEqual(
    list.map((item) => item.id).sort()
  )
}

function row(id: string, parentId: string | null, title = id): ImportParent {
  return { id, title, parentId }
}

describe("父级树拍平：按 DFS 输出", () => {
  it("交错的扁平输入重排成与网页端页面树一致的顺序", () => {
    // 实拍形态：服务端按全空间 sort_order 返回，不同父级的子页彼此交错
    const list: ImportParent[] = [
      row("2", null, "2 需求"),
      row("3", null, "3 设计"),
      row("4", null, "4 开发"),
      row("2.6", "2", "2.6 灰度方案"),
      row("3.5", "3", "3.5 接口设计"),
      row("4.6", "4", "4.6 联调"),
      row("6", null, "6 值班手册"),
      row("2.7", "2", "2.7 回滚方案"),
      row("3.6", "3", "3.6 数据模型"),
      row("4.7", "4", "4.7 上线"),
      row("7", null, "7 归档"),
      row("2.8", "2", "2.8 监控")
    ]
    const out = flattenParents(list)
    expectComplete(list, out)
    expect(out.map((item) => item.id)).toEqual([
      "2",
      "2.6",
      "2.7",
      "2.8",
      "3",
      "3.5",
      "3.6",
      "4",
      "4.6",
      "4.7",
      "6",
      "7"
    ])
    expect(out.map((item) => item.depth)).toEqual([
      0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0
    ])
    expect(out[1]).toEqual({
      id: "2.6",
      title: "2.6 灰度方案",
      parentId: "2",
      depth: 1
    })
  })

  it("多层嵌套：父页排在所有子页之前，depth 按层级递增", () => {
    const list = [
      row("a", null),
      row("b", "a"),
      row("c", "b"),
      row("d", "c"),
      row("e", null)
    ]
    const out = flattenParents(list)
    expectComplete(list, out)
    expect(out.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e"])
    expect(out.map((item) => item.depth)).toEqual([0, 1, 2, 3, 0])
  })

  it("同一父级的兄弟保持输入相对次序，根与根之间也一样", () => {
    const list = [
      row("root-b", null),
      row("root-a", null),
      row("b-2", "root-b"),
      row("b-1", "root-b"),
      row("a-1", "root-a")
    ]
    const out = flattenParents(list)
    expectComplete(list, out)
    // 不按 title 排序，也不按 id 排序：就是接口给的相对次序
    expect(out.map((item) => item.id)).toEqual([
      "root-b",
      "b-2",
      "b-1",
      "root-a",
      "a-1"
    ])
    expect(out.map((item) => item.depth)).toEqual([0, 1, 1, 0, 1])
  })

  it("父级不在返回列表里的孤儿行按根级处理，子树仍缩进在它下面", () => {
    const list = [
      row("x", "gone"),
      row("r", null),
      row("y", "x"),
      row("z", "never-returned")
    ]
    const out = flattenParents(list)
    expectComplete(list, out)
    expect(out.map((item) => item.id)).toEqual(["x", "y", "r", "z"])
    expect(out.map((item) => item.depth)).toEqual([0, 1, 0, 0])
  })

  it("成环与自指不死循环、不丢行：未遍历到的按根级补在末尾", () => {
    // p ↔ q 成环，c 挂在环上；s 指向自己；r 是正常根
    const list = [
      row("p", "q"),
      row("q", "p"),
      row("c", "p"),
      row("r", null),
      row("s", "s")
    ]
    const out = flattenParents(list)
    expectComplete(list, out)
    expect(out.map((item) => item.id)).toEqual(["r", "s", "p", "q", "c"])
    expect(out.map((item) => item.depth)).toEqual([0, 0, 0, 0, 0])
  })

  it("空列表返回空下拉", () => {
    expect(flattenParents([])).toEqual([])
  })

  it("重复 id 的异常行也各输出一次（按行下标记账，不按 id）", () => {
    const list = [row("a", null), row("a", null), row("b", "a")]
    const out = flattenParents(list)
    expectComplete(list, out)
    expect(out.map((item) => item.id)).toEqual(["a", "b", "a"])
    expect(out.map((item) => item.depth)).toEqual([0, 1, 0])
  })
})
