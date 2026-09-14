/**
 * mcp-client-plugin · client REST surface.
 *
 * A thin typed wrapper over `/api/mcp-client/*`. No caching and no React here —
 * `hooks.ts` owns dedupe + cache. Types are imported TYPE-ONLY from `../core`
 * so this browser bundle never pulls the core's `node:*` imports.
 *
 * Wire shapes mirror `core/effective-view.ts` + the route handlers in
 * `../server/routes.ts`.
 * See change: extract-mcp-client-plugin (task 7.1).
 */
import type { EffectiveView } from "../core/effective-view.js";
import type { AdapterVerdict, Scope, ServerEntry } from "../core/types.js";

const API_BASE = "/api/mcp-client";

/** `GET /effective` = the effective view plus the adapter verdict. */
export type EffectiveResponse = EffectiveView & { adapter: AdapterVerdict };

/** The wire body of `PUT /servers/:name` / `PUT /servers/:name/disabled`. */
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
  readonly timeoutMs: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: string[],
    timeoutMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields ?? [];
    this.timeoutMs = timeoutMs;
  }

  /** The effective-view / disabled-toggle load deadline (504 `adapter-timeout`). */
  get isAdapterTimeout(): boolean {
    return this.status === 504 && this.code === "adapter-timeout";
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
  timeoutMs?: unknown;
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
    typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
  );
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

function put(body: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** `GET /effective` — the effective view for a cwd, or global when omitted. */
export async function fetchEffective(cwd?: string): Promise<EffectiveResponse> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  return readJson<EffectiveResponse>(await fetch(`${API_BASE}/effective${qs}`));
}

/** `GET /schema` — the published JSON Schema for `ServerEntry` + `McpSettings`. */
export async function fetchSchema(): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(await fetch(`${API_BASE}/schema`));
}

/** `PUT /servers/:name` — merge a patch (and unset keys) at one scope. */
export async function patchServer(
  name: string,
  body: ScopeWire & { set: Record<string, unknown>; unset?: string[] },
): Promise<void> {
  await readJson<unknown>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}`, put(body)),
  );
}

/** `DELETE /servers/:name` — returns the removed entry (the undo payload). */
export async function removeServer(
  name: string,
  body: ScopeWire,
): Promise<{ removed?: ServerEntry }> {
  const params = new URLSearchParams();
  params.set("scope", body.scope);
  if (body.cwd !== undefined) params.set("cwd", body.cwd);
  const qs = params.toString();
  return readJson<{ removed?: ServerEntry }>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}?${qs}`, { method: "DELETE" }),
  );
}

/** `PUT /servers/:name/disabled` — the row switch write. */
export async function setServerDisabled(
  name: string,
  disabled: boolean,
  body: ScopeWire,
): Promise<void> {
  await readJson<unknown>(
    await fetch(`${API_BASE}/servers/${encodeURIComponent(name)}/disabled`, put({ ...body, disabled })),
  );
}

/** `PUT /settings` — the adapter's global settings patch. */
export async function patchSettings(set: Record<string, unknown>, unset: string[] = []): Promise<void> {
  await readJson<unknown>(await fetch(`${API_BASE}/settings`, put({ set, unset })));
}
