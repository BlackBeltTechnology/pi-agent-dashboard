/**
 * Client helpers for the `/api/openspec/tasks` endpoints.
 *
 * Pure fetch wrappers — throw typed errors so UI can map 409 (line-mismatch)
 * to a refetch + banner without string-matching.
 */
import { getApiBase } from "../api/api-context.js";

export interface OpenSpecTask {
  id: string;
  text: string;
  done: boolean;
  line: number;
  group: string;
}

export interface TasksPayload {
  tasks: OpenSpecTask[];
  groups: string[];
}

export class LineMismatchError extends Error {
  readonly code = "LINE_MISMATCH" as const;
  constructor(message = "line mismatch") {
    super(message);
  }
}

export async function fetchTasks(
  cwd: string,
  change: string,
  signal?: AbortSignal,
): Promise<TasksPayload> {
  const url = `${getApiBase()}/api/openspec/tasks?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(change)}`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `fetch tasks failed (${res.status})`);
  }
  return json.data;
}

export async function toggleTask(
  cwd: string,
  change: string,
  id: string,
  done: boolean,
  line: number,
): Promise<OpenSpecTask> {
  const res = await fetch(`${getApiBase()}/api/openspec/tasks/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, change, id, done, line }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 409) {
    throw new LineMismatchError(json?.error ?? "line mismatch");
  }
  if (!res.ok || !json.success) {
    throw new Error(json?.error ?? `toggle failed (${res.status})`);
  }
  return json.data.task;
}
