/**
 * Thin REST client for the folder-scoped goal endpoints. Route hrefs use the
 * runtime `./sdk` folder codec (no local copy).
 *
 * Uses relative `/api/...` URLs (same-origin), matching the automation +
 * subagents plugin REST convention. The server wraps responses in
 * `{ success, data?, error? }` (ApiResponse).
 *
 * See change: add-goals-folder-page (tasks 3.x / 4.x).
 */
import { folderRouteHref } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import type {
  GoalBudget,
  GoalCriterion,
  GoalJudge,
  GoalRecord,
  GoalRecordStatus,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

// ── URL builders for the goals overlay routes ─────────────────────
export function goalsBoardUrl(cwd: string): string {
  return folderRouteHref(cwd, "/goals");
}
export function goalDetailUrl(cwd: string, goalId: string): string {
  return folderRouteHref(cwd, `/goals/${encodeURIComponent(goalId)}`);
}

// ── REST ──────────────────────────────────────────────────────────
function url(cwd: string, suffix = ""): string {
  return `/api/folders/goals${suffix}?cwd=${encodeURIComponent(cwd)}`;
}

async function parseError(res: Response): Promise<string> {
  try {
    return (await res.json())?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function unwrap<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(await parseError(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? `${what} failed`);
  return json.data as T;
}

export async function fetchGoals(cwd: string, signal?: AbortSignal): Promise<GoalRecord[]> {
  const res = await fetch(url(cwd), { signal });
  return unwrap<GoalRecord[]>(res, "fetch goals");
}

export async function createGoal(
  cwd: string,
  body: { objective: string; criteria?: GoalCriterion[]; budget?: GoalBudget; judge?: GoalJudge; autoRespawn?: boolean },
): Promise<GoalRecord> {
  const res = await fetch(url(cwd), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<GoalRecord>(res, "create goal");
}

export async function updateGoal(
  cwd: string,
  id: string,
  body: { objective?: string; criteria?: GoalCriterion[]; budget?: GoalBudget; judge?: GoalJudge; status?: GoalRecordStatus; autoRespawn?: boolean },
): Promise<GoalRecord> {
  const res = await fetch(url(cwd, `/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<GoalRecord>(res, "update goal");
}

export async function deleteGoal(cwd: string, id: string): Promise<void> {
  const res = await fetch(url(cwd, `/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "delete goal failed");
}

export async function linkSession(cwd: string, id: string, sessionId: string): Promise<void> {
  const res = await fetch(url(cwd, `/${encodeURIComponent(id)}/sessions`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function spawnSession(cwd: string, id: string, model?: string): Promise<void> {
  const res = await fetch(url(cwd, `/${encodeURIComponent(id)}/sessions`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spawn: true, ...(model ? { model } : {}) }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

// ── Judge-model list (dashboard's known/favorite models) ──────────
/** Parse a `provider/modelId` label into a GoalJudge-compatible pair. */
export function parseModelLabel(label: string): { provider: string; modelId: string } {
  const slash = label.indexOf("/");
  if (slash <= 0) return { provider: "", modelId: label };
  return { provider: label.slice(0, slash), modelId: label.slice(slash + 1) };
}

/** Fetch the dashboard's favorite/known model labels for the judge picker. */
export async function fetchJudgeModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch("/api/favorite-models", { signal });
  if (!res.ok) throw new Error(await parseError(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "fetch models failed");
  const labels = json.data?.labels;
  return Array.isArray(labels) ? labels.filter((l: unknown): l is string => typeof l === "string") : [];
}

export async function unlinkSession(cwd: string, id: string, sessionId: string): Promise<void> {
  const res = await fetch(url(cwd, `/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res));
}
