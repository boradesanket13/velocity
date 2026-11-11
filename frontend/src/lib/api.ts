import axios from "axios"

export type DeploymentStatus = "queued" | "building" | "uploading" | "deployed" | "failed"

export interface Deployment {
  id: string
  repoUrl: string
  branch?: string
  rootDir?: string
  outputDir?: string
  status: DeploymentStatus
  error?: string
  url: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export interface CreateDeploymentInput {
  repoUrl: string
  branch?: string
  rootDir?: string
  outputDir?: string
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000"

const KEY_STORAGE = "webhost.apiKey"

export function getStoredApiKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? ""
  } catch {
    return ""
  }
}

export function storeApiKey(key: string): void {
  try {
    sessionStorage.setItem(KEY_STORAGE, key)
  } catch {
  }
}

const client = (apiKey: string) =>
  axios.create({
    baseURL: API_URL,
    timeout: 20_000,
    headers: { Authorization: `Bearer ${apiKey}` },
  })

export async function createDeployment(apiKey: string, input: CreateDeploymentInput): Promise<Deployment> {
  const res = await client(apiKey).post<Deployment>("/v1/deployments", input)
  return res.data
}

export async function getDeployment(apiKey: string, id: string): Promise<Deployment> {
  const res = await client(apiKey).get<Deployment>(`/v1/deployments/${id}`)
  return res.data
}

export async function getLogs(apiKey: string, id: string): Promise<string> {
  const res = await client(apiKey).get<string>(`/v1/deployments/${id}/logs`, { responseType: "text" })
  return res.data
}

export function isTerminal(status: DeploymentStatus): boolean {
  return status === "deployed" || status === "failed"
}

/** Turns axios/network errors into something a user can act on. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response) {
      const data = err.response.data as { error?: string; details?: { message: string }[] } | undefined
      if (err.response.status === 401) return "Invalid access key."
      const detail = data?.details?.map((d) => d.message).join("; ")
      return detail || data?.error || `Request failed (${err.response.status}).`
    }
    return "Cannot reach the API. Check your connection and VITE_API_URL."
  }
  return err instanceof Error ? err.message : "Something went wrong."
}
