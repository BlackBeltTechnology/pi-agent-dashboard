/**
 * Thin REST client for the jj-plugin endpoints. Mirrors the patterns used
 * by `packages/client/src/lib/git-api.ts` etc.
 *
 * See change: add-jj-workspace-plugin.
 */

export interface JjWorkspaceListEntry {
  name: string;
  changeIdShort?: string;
  commitIdShort?: string;
  description?: string;
}

export interface JjAddWorkspaceArgs {
  fromCwd: string;
  name: string;
  baseRev?: string;
  taskDescription?: string;
}

export interface JjAddWorkspaceResponse {
  workspacePath: string;
  spawned: boolean;
  spawnMessage?: string;
  taskDescription?: string | null;
}

export interface JjForgetWorkspaceArgs {
  cwd: string;
  name: string;
  force?: boolean;
}

export interface JjUnfoldedWorkResponse {
  unfolded: string[];
}

async function postJson<T>(path: string, body: unknown): Promise<{
  ok: true;
  status: number;
  data: T;
} | {
  ok: false;
  status: number;
  code?: string;
  data?: unknown;
  message: string;
}> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && (json as { success?: boolean }).success === true) {
    return { ok: true, status: res.status, data: (json as { data: T }).data };
  }
  return {
    ok: false,
    status: res.status,
    code: (json as { error?: string }).error,
    data: (json as { data?: unknown }).data,
    message: typeof (json as { error?: string }).error === "string"
      ? (json as { error: string }).error
      : `HTTP ${res.status}`,
  };
}

export async function listWorkspaces(cwd: string): Promise<JjWorkspaceListEntry[]> {
  const res = await fetch(`/api/jj/workspace/list?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as { success?: boolean }).success !== true) return [];
  const data = (json as { data?: { workspaces?: JjWorkspaceListEntry[] } }).data;
  return data?.workspaces ?? [];
}

export function addWorkspace(args: JjAddWorkspaceArgs) {
  return postJson<JjAddWorkspaceResponse>("/api/jj/workspace/add", args);
}

export function forgetWorkspace(args: JjForgetWorkspaceArgs) {
  return postJson<{ name: string; force: boolean }>(
    "/api/jj/workspace/forget",
    args,
  );
}

export function initColocated(cwd: string) {
  return postJson<{ cwd: string }>("/api/jj/init-colocated", { cwd });
}
