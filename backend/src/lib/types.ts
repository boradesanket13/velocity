export type DeploymentStatus = "queued" | "building" | "uploading" | "deployed" | "failed";

export const ACTIVE_STATUSES: readonly DeploymentStatus[] = ["queued", "building", "uploading"];

export interface Deployment {
  id: string;
  owner: string;
  repoUrl: string;
  branch?: string;
  rootDir?: string;
  outputDir?: string;
  status: DeploymentStatus;
  error?: string;
  /** Public URL the site is (or will be) served from. */
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/** What the API returns to clients (never leaks the owner). */
export type PublicDeployment = Omit<Deployment, "owner">;

export function toPublic(d: Deployment): PublicDeployment {
  const { owner: _owner, ...rest } = d;
  return rest;
}

export interface BuildJob {
  deploymentId: string;
}
