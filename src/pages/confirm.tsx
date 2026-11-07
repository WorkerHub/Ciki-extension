import "@/index.css"
import { ArrowUpRight, Loader2, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  type ConfirmInput,
  checkConflict,
  executeImport,
  type ImportContext,
  type ImportResult,
  type ProgressUpdate,
  prepareImport
} from "@/flow/import"
import { reportLines } from "@/flow/report"
import { ImportError, toImportError } from "@/shared/errors"
import { clearRun, getRun } from "@/shared/run-store"

const ROOT_VALUE = "__root__"

type Phase = "loading" | "form" | "running" | "done" | "error"

interface FailureView {
  title: string
  message: string
  hint: string
  stop: boolean
}

const CONFLICT_LABELS: Record<string, string> = {
  update: "更新同名页（默认）",
  create_copy: "另存为新页",
  cancel: "取消"
}

export function Confirm() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [confirm, setConfirm] = useState<ConfirmInput | null>(null)
  const [title, setTitle] = useState("")
  const [parentId, setParentId] = useState<string | null>(null)
  const [conflict, setConflict] = useState("create_copy")
  const [conflictExists, setConflictExists] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [failure, setFailure] = useState<FailureView | null>(null)
  const contextRef = useRef<ImportContext | null>(null)
  const runIdRef = useRef("")
  const checkTimer = useRef<number | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const runId =
          new URLSearchParams(window.location.search).get("run") || ""
        runIdRef.current = runId
        const job = await getRun(runId)
        if (!job) {
          throw new ImportError(
            "NOT_FOUND",
            "这一批的上下文已经丢了（浏览器重启过，或这次搬运已经完成）",
            {
              title: "这次搬运已经结束",
              hint: "回 Confluence 页再点一次「搬到 ciki」重新来一批。"
            }
          )
        }
        const prepared = await prepareImport(job)
        contextRef.current = prepared.context
        setConfirm(prepared.confirm)
        setTitle(prepared.confirm.sourceTitle)
        setParentId(prepared.confirm.defaultParentId)
        setConflictExists(prepared.confirm.conflict.exists)
        setConflict(prepared.confirm.conflict.exists ? "update" : "create_copy")
        setPhase("form")
      } catch (error) {
        setFailure(viewOf(error))
        setPhase("error")
      }
    }
    void load()
  }, [])

  const recheck = useCallback(
    (nextTitle: string, nextParent: string | null) => {
      const context = contextRef.current
      if (!context) return
      if (checkTimer.current) window.clearTimeout(checkTimer.current)
      checkTimer.current = window.setTimeout(() => {
        void checkConflict(context, nextTitle.trim(), nextParent)
          .then((value) => {
            setConflictExists(value.exists)
            setConflict((current) =>
              value.exists
                ? current === "cancel"
                  ? "cancel"
                  : "update"
                : "create_copy"
            )
          })
          .catch(() => {
            // 查冲突失败不拦人：建页时服务端还会再判一次
          })
      }, 400)
    },
    []
  )

  const start = async () => {
    const context = contextRef.current
    if (!context || !title.trim()) return
    setPhase("running")
    setProgress([])
    try {
      const outcome = await executeImport(
        context,
        {
          title: title.trim(),
          parentId,
          conflict: conflict === "update" ? "update" : "create_copy"
        },
        (update: ProgressUpdate) => {
          setProgress((lines) => [
            ...lines,
            `${update.step}${update.detail ? `：${update.detail}` : ""}${
              update.current && update.total
                ? `（${update.current}/${update.total}）`
                : ""
            }`
          ])
        }
      )
      await clearRun(runIdRef.current)
      setResult(outcome)
      setPhase("done")
    } catch (error) {
      setFailure(viewOf(error))
      setPhase("error")
    }
  }

  // executeImport 已经把根相对路径补成了绝对地址（见 cikiPageUrl）
  const pageUrl = result ? result.url : ""

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">搬到 ciki</div>
        <div className="truncate text-xs text-muted-foreground">
          {confirm
            ? confirm.sourceUrl || `pageId ${confirm.pageId}`
            : "正在读取页面…"}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            {phase === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" /> 正在读取正文、附件清单与
                ciki 页面树…
              </div>
            ) : null}

            {phase === "form" && confirm ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">确认</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="title">标题（可改）</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value)
                        recheck(event.target.value, parentId)
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>父级</Label>
                    <Select
                      value={parentId ?? ROOT_VALUE}
                      onValueChange={(value) => {
                        const next = value === ROOT_VALUE ? null : value
                        setParentId(next)
                        recheck(title, next)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ROOT_VALUE}>
                          顶层（不挂父页）
                        </SelectItem>
                        {confirm.parents.map((parent) => (
                          <SelectItem key={parent.id} value={parent.id}>
                            {`${"　".repeat(parent.depth)}${parent.title}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {conflictExists ? (
                    <>
                      <Separator />
                      <div className="space-y-1.5">
                        <Label>ciki 里已有同名页</Label>
                        <Select value={conflict} onValueChange={setConflict}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="update">
                              {CONFLICT_LABELS.update}
                            </SelectItem>
                            <SelectItem value="create_copy">
                              {CONFLICT_LABELS.create_copy}
                            </SelectItem>
                            <SelectItem value="cancel">
                              {CONFLICT_LABELS.cancel}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          更新会生成新版本（可在 ciki
                          版本历史回滚）；另存会新建一页。
                        </p>
                      </div>
                    </>
                  ) : null}

                  <Button
                    className="w-full"
                    disabled={!title.trim() || conflict === "cancel"}
                    onClick={() => void start()}
                  >
                    开始搬运
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {phase === "running" ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin" />{" "}
                  正在搬运，逐张图片串行处理
                </div>
                <div className="text-xs text-muted-foreground">
                  {progress[progress.length - 1] || "准备中…"}
                </div>
              </div>
            ) : null}

            {phase === "done" && result ? (
              <div className="space-y-3">
                <Alert>
                  <AlertTitle>已写入 ciki</AlertTitle>
                  <AlertDescription>
                    {result.report.conflict === "update"
                      ? "同名页已更新（生成新版本）"
                      : "已另存为新页面"}
                  </AlertDescription>
                </Alert>
                <Button asChild className="w-full">
                  <a href={pageUrl} target="_blank" rel="noreferrer">
                    在 ciki 打开
                    <ArrowUpRight />
                  </a>
                </Button>
                <div className="space-y-1 rounded-lg border p-3 text-xs leading-relaxed">
                  {reportLines(result.report).map((line, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 报告是先算出来的纯文本行，没有稳定 id
                    <div key={`${index}-${line}`} className="break-words">
                      {line}
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.close()}
                >
                  关闭
                </Button>
              </div>
            ) : null}

            {phase === "error" && failure ? (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertTitle>{failure.title}</AlertTitle>
                  <AlertDescription>{failure.message}</AlertDescription>
                </Alert>
                <p className="text-xs text-muted-foreground">{failure.hint}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => window.close()}
                  >
                    关闭
                  </Button>
                  {!failure.stop ? (
                    <Button
                      className="flex-1"
                      onClick={() => window.location.reload()}
                    >
                      <RotateCcw />
                      重新打开
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function viewOf(error: unknown): FailureView {
  const value = toImportError(error)
  return {
    title: value.title,
    message: value.message,
    hint: value.hint,
    stop: value.stop
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<Confirm />)
