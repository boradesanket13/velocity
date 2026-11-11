import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createDeployment,
  errorMessage,
  getDeployment,
  getLogs,
  getStoredApiKey,
  isTerminal,
  storeApiKey,
  type Deployment,
} from "@/lib/api"

const STATUS_LABEL: Record<Deployment["status"], string> = {
  queued: "Queued…",
  building: "Building…",
  uploading: "Publishing…",
  deployed: "Deployed",
  failed: "Failed",
}

const MAX_POLL_ERRORS = 5

export function Landing() {
  const [apiKey, setApiKey] = useState(getStoredApiKey)
  const [repoUrl, setRepoUrl] = useState("")
  const [branch, setBranch] = useState("")
  const [rootDir, setRootDir] = useState("")
  const [outputDir, setOutputDir] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const active = deployment !== null && !isTerminal(deployment.status)
  const deploymentId = deployment?.id
  const finished = deployment !== null && isTerminal(deployment.status)
  const apiKeyRef = useRef(apiKey)
  apiKeyRef.current = apiKey

  useEffect(() => {
    if (!deploymentId || !active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let delay = 2000
    let failures = 0

    const tick = async () => {
      try {
        const latest = await getDeployment(apiKeyRef.current, deploymentId)
        if (cancelled) return
        failures = 0
        setDeployment(latest)
        if (isTerminal(latest.status)) return
      } catch (err) {
        if (cancelled) return
        failures += 1
        if (failures >= MAX_POLL_ERRORS) {
          setError(`Lost contact with the API: ${errorMessage(err)}`)
          return
        }
      }
      delay = Math.min(delay * 1.3, 10_000)
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [deploymentId, active])

  const loadLogs = useCallback(async () => {
    if (!deploymentId) return
    try {
      setLogs(await getLogs(apiKeyRef.current, deploymentId))
    } catch (err) {
      setLogs(`Logs are not available: ${errorMessage(err)}`)
    }
  }, [deploymentId])
  useEffect(() => {
    if (deployment?.status === "failed") void loadLogs()
  }, [deployment?.status, loadLogs])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setLogs(null)
    setSubmitting(true)
    try {
      storeApiKey(apiKey)
      const created = await createDeployment(apiKey, {
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || undefined,
        rootDir: rootDir.trim() || undefined,
        outputDir: outputDir.trim() || undefined,
      })
      setDeployment(created)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setDeployment(null)
    setLogs(null)
    setError("")
  }

  const copyUrl = async () => {
    if (!deployment) return
    try {
      await navigator.clipboard.writeText(deployment.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Deploy your GitHub Repository</CardTitle>
          <CardDescription>Enter the URL of a public GitHub repository to build and deploy it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="api-key">Access key</Label>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={active}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="github-url">GitHub Repository URL</Label>
              <Input
                id="github-url"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repo"
                disabled={active}
                required
              />
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Advanced options</summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="branch">Branch</Label>
                  <Input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" disabled={active} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="root-dir">Root directory</Label>
                  <Input id="root-dir" value={rootDir} onChange={(e) => setRootDir(e.target.value)} placeholder="e.g. apps/web (monorepos)" disabled={active} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="output-dir">Output directory</Label>
                  <Input id="output-dir" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="auto-detects dist, build, out" disabled={active} />
                </div>
              </div>
            </details>

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <Button className="w-full" type="submit" disabled={submitting || active}>
              {submitting ? "Submitting…" : active && deployment ? `${STATUS_LABEL[deployment.status]} (${deployment.id})` : "Deploy"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {deployment?.status === "deployed" && (
        <Card className="w-full max-w-md mt-8">
          <CardHeader>
            <CardTitle className="text-xl">Deployed</CardTitle>
            <CardDescription>Your website is live.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="deployed-url">Deployed URL</Label>
              <div className="flex gap-2">
                <Input id="deployed-url" readOnly type="url" value={deployment.url} />
                <Button type="button" variant="outline" onClick={copyUrl}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button asChild className="flex-1" variant="outline">
                <a href={deployment.url} target="_blank" rel="noopener noreferrer">
                  Visit website
                </a>
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Deploy another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {deployment?.status === "failed" && (
        <Card className="w-full max-w-md mt-8">
          <CardHeader>
            <CardTitle className="text-xl">Deployment failed</CardTitle>
            <CardDescription>{deployment.error ?? "The deployment did not complete."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={reset}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {finished && deployment && (
        <Card className="w-full max-w-2xl mt-8">
          <CardHeader>
            <CardTitle className="text-base">Build logs</CardTitle>
          </CardHeader>
          <CardContent>
            {logs === null ? (
              <Button type="button" variant="outline" onClick={loadLogs}>
                Show build logs
              </Button>
            ) : (
              <pre className="max-h-96 overflow-auto rounded bg-black p-3 text-xs text-green-200 whitespace-pre-wrap">{logs || "(empty)"}</pre>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
