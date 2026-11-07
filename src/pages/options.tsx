import "@/index.css"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { ImportApi } from "@/ciki/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { describeImportError } from "@/shared/errors"
import { sendMessage } from "@/shared/messages"
import {
  EMPTY_SETTINGS,
  loadSettings,
  normalizeHttpUrl,
  notifySettingsChanged,
  permissionPattern,
  type Settings,
  saveSettings
} from "@/shared/settings"

type Tone = "ok" | "error" | "info"

interface StatusLine {
  tone: Tone
  text: string
}

export function Options() {
  const [form, setForm] = useState<Settings>(EMPTY_SETTINGS)
  const [status, setStatus] = useState<StatusLine | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadSettings().then(setForm)
  }, [])

  const update = (patch: Partial<Settings>) =>
    setForm((current) => ({ ...current, ...patch }))

  /** 校验 + 申请域名的可选权限（必须是点击后的第一次 await）。 */
  const persist = async (): Promise<Settings | null> => {
    const confluence = normalizeHttpUrl(form.confluenceUrl)
    const ciki = normalizeHttpUrl(form.cikiUrl)
    if (!confluence) {
      setStatus({
        tone: "error",
        text: "Confluence 实例地址要是完整的 http(s) 地址"
      })
      return null
    }
    if (!ciki) {
      setStatus({ tone: "error", text: "ciki 地址要是完整的 http(s) 地址" })
      return null
    }
    const origins = [
      permissionPattern(confluence),
      permissionPattern(ciki)
    ].filter((value): value is string => Boolean(value))
    let granted = false
    try {
      granted = await chrome.permissions.request({ origins })
    } catch (error) {
      setStatus({ tone: "error", text: describeImportError(error) })
      return null
    }
    if (!granted) {
      setStatus({
        tone: "error",
        text: "没有域名权限：插件读不到 Confluence，也无法写 ciki。请重新保存并点「允许」。"
      })
      return null
    }
    const saved = await saveSettings({
      confluenceUrl: confluence,
      cikiUrl: ciki,
      importToken: form.importToken.trim()
    })
    setForm(saved)
    await notifySettingsChanged()
    return saved
  }

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const saved = await persist()
      if (saved) setStatus({ tone: "ok", text: "已保存，域名权限已授权" })
    } finally {
      setBusy(false)
    }
  }

  const saveAndTest = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const saved = await persist()
      if (!saved) return
      const confluence = await sendMessage<{ json: unknown }>({
        type: "confluence:json",
        url: `${saved.confluenceUrl}/rest/api/content?limit=1`
      })
      if (!confluence.ok) {
        setStatus({
          tone: "error",
          text: `Confluence：${confluence.message}（${confluence.hint}）`
        })
        return
      }
      let parentCount = 0
      try {
        const parents = await new ImportApi(
          saved.cikiUrl,
          saved.importToken
        ).parents()
        parentCount = parents.length
      } catch (error) {
        setStatus({
          tone: "error",
          text: `ciki：${describeImportError(error)}`
        })
        return
      }
      setStatus({
        tone: "ok",
        text: `都通了：Confluence 只读接口 200，ciki 导入接口读到 ${parentCount} 个父级`
      })
    } catch (error) {
      setStatus({ tone: "error", text: describeImportError(error) })
    } finally {
      setBusy(false)
    }
  }

  const clearDefaultParent = async () => {
    const saved = await saveSettings({
      defaultParentId: null,
      defaultParentTitle: ""
    })
    setForm(saved)
    setStatus({ tone: "info", text: "已清掉记住的默认父级" })
  }

  return (
    <div className="mx-auto w-full max-w-[720px] p-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold">ciki 搬运助手 · 设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          两个地址都由你填写，插件里没有任何写死的域名；保存时只为这两个域名申请访问权限，
          随时可以在 Chrome 的扩展详情里撤销。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">连接</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="confluence">Confluence 实例地址</Label>
            <Input
              id="confluence"
              value={form.confluenceUrl}
              placeholder="https://confluence.example.com"
              onChange={(event) =>
                update({ confluenceUrl: event.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              自建版填站点根地址；Cloud 版填到 /wiki。填错会在「测试」里报出来。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ciki">ciki 地址</Label>
            <Input
              id="ciki"
              value={form.cikiUrl}
              placeholder="https://ciki.example.com"
              onChange={(event) => update({ cikiUrl: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="token">导入令牌</Label>
            <Input
              id="token"
              type="password"
              autoComplete="off"
              value={form.importToken}
              placeholder="在 ciki 设置页生成后粘贴到这里"
              onChange={(event) => update({ importToken: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              只存在本机浏览器（chrome.storage.local），不会随同步上传；令牌等同你本人的导入权限，
              泄了就回 ciki 重置。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button disabled={busy} onClick={() => void saveAndTest()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              保存并测试
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void save()}
            >
              仅保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">默认父级</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {form.defaultParentTitle ? (
              <>
                记住的默认父级：
                <span className="font-medium">{form.defaultParentTitle}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                还没有——下次搬运确认时选的父级会被记住
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!form.defaultParentTitle}
            onClick={() => void clearDefaultParent()}
          >
            清除
          </Button>
        </CardContent>
      </Card>

      {status ? (
        <Alert
          className="mt-4"
          variant={status.tone === "error" ? "destructive" : "default"}
        >
          <AlertTitle>
            {status.tone === "ok"
              ? "成功"
              : status.tone === "error"
                ? "没成功"
                : "提示"}
          </AlertTitle>
          <AlertDescription>{status.text}</AlertDescription>
        </Alert>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        权限说明：插件只要 activeTab / scripting / storage
        三项，加上你这两个域名的按需授权； 不读取、不存储、不外传 Confluence 的
        cookie 与凭据，请求只带浏览器当前登录态。
      </p>
    </div>
  )
}

createRoot(document.getElementById("root") as HTMLElement).render(<Options />)
