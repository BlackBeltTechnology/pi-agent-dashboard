/**
 * Client fetch helpers for `GET` / `PUT /api/openspec/dependencies`.
 *
 * See change: add-openspec-change-dependencies.
 */
import type { DeclaredDependencies, FileStat } from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
import type { ChangeDependencies } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "../api/api-context.js";

export type { DeclaredBlocker, DeclaredDependencies } from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
export type DependenciesFileStat = FileStat;

export interface DependenciesGet {
  dependencies: ChangeDependencies | null;
  declared: DeclaredDependencies | null;
  /** `invalid-file` message when the file exists but cannot be used. */
  declaredError: string | null;
  /** Precondition token for the PUT (`null` = no file yet). */
  file: DependenciesFileStat | null;
}

/** A refusal; `reason` is the server's machine code (`modified`, `locked`, `pending`, …). */
export class DependenciesApiError extends Error {
  readonly status: number;
  readonly reason: string | undefined;
  constructor(message: string, status: number, reason: string | undefined) {
    super(message);
    this.name = "DependenciesApiError";
    this.status = status;
    this.reason = reason;
  }
}

async function failure(res: Response): Promise<DependenciesApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
  return new DependenciesApiError(body?.error ?? `HTTP ${res.status}`, res.status, body?.reason);
}

export async function fetchDependencies(cwd: string, change: string, signal?: AbortSignal): Promise<DependenciesGet> {
  const url = `${getApiBase()}/api/openspec/dependencies?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(change)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as { success?: boolean; data?: DependenciesGet; error?: string };
  if (!json.success || !json.data) throw new DependenciesApiError(json.error ?? "fetch dependencies failed", res.status, undefined);
  return json.data;
}

export interface SaveDependenciesBody extends DeclaredDependencies {
  cwd: string;
  change: string;
  /** The `file` value GET returned. */
  expected: DependenciesFileStat | null;
}

export async function saveDependencies(body: SaveDependenciesBody): Promise<{ file: DependenciesFileStat }> {
  const res = await fetch(`${getApiBase()}/api/openspec/dependencies`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as { success?: boolean; data?: { file: DependenciesFileStat }; error?: string };
  if (!json.success || !json.data) throw new DependenciesApiError(json.error ?? "save dependencies failed", res.status, undefined);
  return json.data;
}
