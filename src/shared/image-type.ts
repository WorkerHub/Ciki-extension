/**
 * 图片 MIME 归一 —— ciki 只认四种写法：image/png、image/jpeg、image/gif、image/webp。
 *
 * Confluence 实例与前置反代常回带参数的响应头（`image/png;charset=UTF-8`）、
 * 非标准别名（`image/jpg`），或干脆回 `application/octet-stream`；原样塞进 data URL 与
 * contentType 会被 ciki 的 data URL 正则与上传白名单全判非法，图就白抓了。
 */

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp"
] as const

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number]

const BY_EXTENSION: Record<string, AcceptedImageType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
}

export function isAcceptedImageType(value: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value)
}

/**
 * 归一成 ciki 认的 MIME；认不出来就按文件扩展名兜底，都认不出返回 ""。
 * @param raw 响应头或附件元数据里的原始写法
 * @param filename 原始文件名（兜底推断用）
 */
export function normalizeImageType(
  raw: string | null | undefined,
  filename = ""
): string {
  const base = (raw ?? "").split(";")[0].trim().toLowerCase()
  // image/jpg 不是标准写法，但不少实例真的这么回
  const canonical = base === "image/jpg" ? "image/jpeg" : base
  if (isAcceptedImageType(canonical)) return canonical
  const extension = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1]?.toLowerCase()
  return extension ? (BY_EXTENSION[extension] ?? "") : ""
}

/** 归一不出来时退而求其次：至少剥掉参数，别把 `;charset=` 带进 data URL。 */
export function baseMimeType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0].trim().toLowerCase()
}
