/**
 * mcp-client-plugin · client REST surface.
 *
 * A thin typed wrapper over `/api/mcp-client/*`. No caching and no React here —
 * `hooks.ts` owns dedupe + cache. Types are imported TYPE-ONLY from `../core`
 * so this browser bundle never pulls the core's `node:*` imports.
 *
 * Wire shapes mirror the route handlers in `../server/routes.ts`.
 * See change: migrate-mcp-to-pi-builtin.
 */
import type { EffectiveView, LiveState, Scope, SetEnabledResult } from "../core/types.js";

const API_BASE = "/api/mcp-client";

/** The wire body of every scoped write. */
export interface ScopeWire {
  scope: "global" | "project";
  cwd?: string;
}

export function scopeToWire(scope: Scope): ScopeWire {
  return scope.kind === "global" ? { scope: "global" } : { scope: "project", cwd: scope.cwd };
}

/** A refusal from any route, carrying the closed `error` code + optional fields. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: string[];

  constructor(status: number, code: string, message: string, fields?: string[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields ?? [];
  }

  /** A cwd outside the dashboard's known-folder set (403 `not-allowed`). */
  get isNotAllowed(): boolean {
    return this.status === 403 && this.code === "not-allowed";
  }
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  fields?: unknown;
}

async function failure(res: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* a non-JSON body carries no code — fall back to the status */
  }
  return new ApiError(
    res.status,
    typeof body.error === "string" ? body.error : `http-${res.status}`,
    typeof body.message === "string" ? body.message : `request failed (${res.status})`,
    Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === "string") : [],
  );
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

function methodWith(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** `GET /effective` — the effective view for a cwd, or global when omitted. */
export async function fetchEffective(cwd?: string): Promise<EffectiveView> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  return readJson<EffectiveView>(await fetch(`${API_BASE}/effective${qs}`));
}

/**
 * `GET /live` — live state from `pi mcp list --json`. SLOW (up to 30 s):
 * call on page view and on an explicit refresh only; render from `/effective`
 * first.
 */
export async function fetchLive(cwd?: string): Promise<LiveState> {
  const params = new URLSearchParams();
  if (cwd) params.set("cwd", cwd);
  const qs = params.toString();
  return readJson<LiveState>(await fetch(`${API_BASE}/live${qs ? `?${qs}` : ""}`));
}

/** `GET /schema` — the published JSON Schema for `ServerEntry`. */
export async function fetchSchema(): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(await fetch(`${API_BASE}/schema`));
}

/** The body of `PUT /servers/:name` — a WHOLE-entry save; `previousName` renames. */
export interface SaveServerBody extends ScopeWire {
  entry: Record<string, unknown>;
  previousName?: string;
  /** A new server: refused (409 name-collision) when the name already exists. */
  create?: boolean;
}

/** `PUT /servers/:name` — replace the entry at one scope. */
export async function saveServer(name: string, body: SaveServerBody): Promise<void> {
  await readJson<unknown>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}`, methodWith("PUT", body)),
  );
}

/** `DELETE /servers/:name` — returns the removed raw entry (the undo payload). */
export async function removeServer(
  name: string,
  wire: ScopeWire,
): Promise<{ removed?: Record<string, unknown> }> {
  const params = new URLSearchParams();
  params.set("scope", wire.scope);
  if (wire.cwd !== undefined) params.set("cwd", wire.cwd);
  return readJson<{ removed?: Record<string, unknown> }>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}?${params.toString()}`, { method: "DELETE" }),
  );
}

/** `PUT /servers/:name/enabled` — the row switch write. */
export async function setEnabled(
  name: string,
  enabled: boolean,
  wire: ScopeWire,
): Promise<SetEnabledResult> {
  return readJson<SetEnabledResult>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}/enabled`, methodWith("PUT", { ...wire, enabled })),
  );
}

/** `POST /servers/:name/convert` — adapter leftovers → pi's entry shape. */
export async function convertServer(name: string, wire: ScopeWire): Promise<void> {
  await readJson<unknown>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}/convert`, methodWith("POST", wire)),
  );
}

