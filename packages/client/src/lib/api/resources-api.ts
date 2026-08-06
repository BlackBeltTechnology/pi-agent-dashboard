/**
 * Client-side fetch helpers for pi-resource ACTIVATION (enable/disable) and the
 * one-click reload of sessions governed by a scope. Distinct from
 * packages-api.ts (install/uninstall/move).
 *
 * See change: folder-resource-activation-toggle.
 */
import { getApiBase } from "./api-context.js";

/** Loose shape of the dashboard's `{ success, data, error }` envelope. */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export type ResourceScope = "local" | "global";
export type ResourceType = "extension" | "skill" | "prompt" | "theme";

export interface ToggleResourceArgs {
  scope: ResourceScope;
  cwd?: string;
  type: ResourceType;
  filePath: string;
  enabled: boolean;
  packageSource?: string;
}

/** One choice the project-trust dialog offers. Mirrors the server's `TrustOption`. */
export interface ResourceTrustOption {
  id: "trust" | "trust-parent" | "decline";
  label: string;
  trusted: boolean;
}

export interface ToggleResourceResult {
  ok: boolean;
  /** Running sessions governed by the toggled scope (for the one-click reload). */
  affectedSessions: string[];
  status: number;
  error?: string;
  /** Set when the folder needs a trust decision before the write can happen. */
  trustRequired?: boolean;
  trustOptions?: ResourceTrustOption[];
  /** True when the folder is trusted implicitly today and this write changes that. */
  implicitlyTrusted?: boolean;
}

/** POST /api/resources/toggle. Never throws on HTTP errors (network errors still throw). */
export async function toggleResource(args: ToggleResourceArgs): Promise<ToggleResourceResult> {
  const res = await fetch(`${getApiBase()}/api/resources/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
    affectedSessions?: string[];
    trustRequired?: boolean;
    trustOptions?: ResourceTrustOption[];
    implicitlyTrusted?: boolean;
  }>;
  return {
    ok: res.ok && body?.success === true,
    affectedSessions: body?.data?.affectedSessions ?? [],
    status: res.status,
    error: body?.error,
    trustRequired: body?.data?.trustRequired,
    trustOptions: body?.data?.trustOptions,
    implicitlyTrusted: body?.data?.implicitlyTrusted,
  };
}

export interface SubmitResourceTrustResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * POST /api/resources/trust. Persists the chosen project-trust option through
 * pi's own store. Only the option *id* travels — the server re-derives the
 * trust-store updates, so a client can never grant trust for an arbitrary path.
 */
export async function submitResourceTrust(
  cwd: string,
  optionId: ResourceTrustOption["id"],
): Promise<SubmitResourceTrustResult> {
  const res = await fetch(`${getApiBase()}/api/resources/trust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, optionId }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<unknown>;
  return { ok: res.ok && body?.success === true, status: res.status, error: body?.error };
}

export interface ReloadResourceSessionsResult {
  ok: boolean;
  reloaded: number;
  status: number;
  error?: string;
}

/** POST /api/resources/reload. Reloads the sessions governed by the scope. */
export async function reloadResourceSessions(
  scope: ResourceScope,
  cwd?: string,
): Promise<ReloadResourceSessionsResult> {
  const res = await fetch(`${getApiBase()}/api/resources/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, cwd }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ reloaded?: number }>;
  return {
    ok: res.ok && body?.success === true,
    reloaded: body?.data?.reloaded ?? 0,
    status: res.status,
    error: body?.error,
  };
}
