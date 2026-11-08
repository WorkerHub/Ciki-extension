import "@/index.css"
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Settings2,
  XCircle
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { sendToTab } from "@/shared/messages"
import { type BridgeStatus, loadBridgeStatus } from "@/shared/run-store"
import {
  isConfigured,
  loadSettings,
  originOf,
  permissionPattern,
  type Settings
} from "@/shared/settings"

interface TabInfo {
  id?: number
  url?: string
}

function Row({
  ok,
  label,
  detail
}: {
  ok: boolean
  label: string
  detail?: string
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {detail ? (
          <div className="truncate text-muted-foreground" title={detail}>
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<TabInfo>({})
  const [granted, setGranted] = useState(false)
  const [bridge, setBridge] = useState<{
    ok: BridgeStatus | null
    error: BridgeStatus | null
  }>({ ok: null, error: null })
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const loaded = await loadSettings()
    setSettings(loaded)
    const [active] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })
    setTab({ id: active?.id, url: active?.url })
    const pattern = permissionPattern(loaded.confluenceUrl)
    const cikiPattern = permissionPattern(loaded.cikiUrl)
    const hasConfluence = pattern
      ? await chrome.permissions.contains({ origins: [pattern] })
      : false
    const hasCiki = cikiPattern
      ? await chrome.permissions.contains({ origins: [cikiPattern] })
      : false
    setGranted(Boolean(hasConfluence && hasCiki))
    setBridge(await loadBridgeStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onConfluencePage = Boolean(
    settings?.confluenceUrl &&
      tab.url &&
      originOf(tab.url) === originOf(settings.confluenceUrl)
  )
  const configured = settings ? isConfigured(settings) : false
  const canRun = configured && granted && onConfluencePage && Boolean(tab.id)

  const start = async () => {
    if (!tab.id) return
    setBusy(true)
    setMessage("")
    try {
      // activeTab 只在用户点插件时有效：按需注入同一份 content script 再让它开工
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      })
      const reply = await sendToTab(tab.id, { type: "page:start" })
      if (!reply.ok) setMessage(`打不开确认小窗：${reply.message}`)
      else window.close()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-[360px] p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">ciki 搬运助手</div>
          <div className="text-xs text-muted-foreground">
            逐页手动搬运，对 Confluence 串行请求
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <Settings2 />
          设置
        </Button>
      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <Row
          ok={Boolean(settings?.confluenceUrl)}
          label="Confluence 实例"
          detail={settings?.confluenceUrl || "还没填"}
        />
        <Row
          ok={Boolean(settings?.cikiUrl)}
          label="ciki 地址"
          detail={settings?.cikiUrl || "还没填"}
        />
        <Row
          ok={Boolean(settings?.importToken)}
          label="导入令牌"
          detail={settings?.importToken ? "已保存（只在本地）" : "还没填"}
        />
        <Row
          ok={granted}
          label="域名授权"
          detail={granted ? "两个地址都已授权" : "配置后需要在设置里允许访问"}
        />
        <Row
          ok={onConfluencePage}
          label="当前标签页"
          detail={
            onConfluencePage
              ? "这是 Confluence 页，可以搬"
              : "不是已配置的 Confluence 页"
          }
        />
        <Row
          ok={Boolean(settings?.defaultParentTitle)}
          label="默认父级"
          detail={settings?.defaultParentTitle || "上次搬运时记住"}
        />
      </div>

      {bridge.error && !bridge.ok ? (
        <div className="mt-3 rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
          补抓最近一次没成功：{bridge.error.message}
        </div>
      ) : bridge.ok ? (
        <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
          <Badge variant="secondary">补抓</Badge>
          最近一张图已转存
        </div>
      ) : null}

      {message ? (
        <div className="mt-2 text-xs text-destructive">{message}</div>
      ) : null}

      <Separator className="my-3" />

      <div className="flex items-center gap-2">
        <Button
          className="flex-1"
          disabled={!canRun || busy}
          onClick={() => void start()}
        >
          搬到 ciki
          <ArrowRight />
        </Button>
        <Button
          variant="outline"
          onClick={() => void chrome.runtime.openOptionsPage()}
          title="打开设置"
        >
          <ExternalLink />
        </Button>
      </div>
      {!configured ? (
        <p className="mt-2 text-xs text-muted-foreground">
          先把实例地址、ciki 地址、导入令牌填进设置，再授权这两个域名。
        </p>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById("root") as HTMLElement).render(<Popup />)
