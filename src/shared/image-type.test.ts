import { describe, expect, it } from "vitest"
import {
  baseMimeType,
  isAcceptedImageType,
  normalizeImageType
} from "./image-type"

describe("图片 MIME 归一", () => {
  it("剥掉 ;charset= 之类的参数", () => {
    expect(normalizeImageType("image/png;charset=UTF-8")).toBe("image/png")
    expect(normalizeImageType("IMAGE/PNG; charset=utf-8")).toBe("image/png")
  })

  it("image/jpg 归到标准的 image/jpeg", () => {
    expect(normalizeImageType("image/jpg")).toBe("image/jpeg")
  })

  it("ciki 不收的格式归一为空（svg/bmp 不进图床）", () => {
    expect(normalizeImageType("image/svg+xml")).toBe("")
    expect(normalizeImageType("image/bmp")).toBe("")
  })

  it("缺头或缺省类型时按扩展名兜底", () => {
    expect(normalizeImageType("", "diagram.png")).toBe("image/png")
    expect(normalizeImageType("application/octet-stream", "photo.JPG")).toBe(
      "image/jpeg"
    )
    expect(normalizeImageType(null, "动画.webp")).toBe("image/webp")
  })

  it("头与扩展名都认不出来就给空串，让调用方自己决定", () => {
    expect(normalizeImageType("application/octet-stream", "attachment")).toBe(
      ""
    )
    expect(normalizeImageType(undefined, "notes.txt")).toBe("")
  })

  it("baseMimeType 只做去参数与转小写", () => {
    expect(baseMimeType("Application/Octet-Stream; foo=bar")).toBe(
      "application/octet-stream"
    )
    expect(baseMimeType("")).toBe("")
  })

  it("isAcceptedImageType 只认 ciki 白名单里的四个", () => {
    expect(isAcceptedImageType("image/png")).toBe(true)
    expect(isAcceptedImageType("image/webp")).toBe(true)
    expect(isAcceptedImageType("image/jpg")).toBe(false)
    expect(isAcceptedImageType("image/png;charset=UTF-8")).toBe(false)
  })
})
