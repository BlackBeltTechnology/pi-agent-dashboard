/**
 * Client helper for the live-server-preview REST API. `start` pre-validates
 * the target with the SAME shared `validateLiveTarget` (SSRF boundary) the
 * server enforces, so free-form remote hosts are refused before any request.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import {
  type LiveServerTarget,
  type LiveTargetAddedBy,
  validateLiveTarget,
} from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { getApiBase } from "./api-context.js";

export type StartResult =
  | { ok: true; target: LiveServerTarget & { path: string } }
  | { ok: false; error: string };

/** Egress + scripts policy bound to a minted capability (design D4). */
export interface PreviewPolicy {
  egress: "open" | "restricted";
  scripts: boolean;
}

/** `{ok:true,…}` or the legacy `{success:true,…}` envelope: both mean accepted. */
const accepted = (body: unknown): body is Record<string, unknown> =>
  !!body && typeof body === "object" && ((body as { ok?: unknown }).ok === true || (body as { success?: unknown }).success === true);

/** List the persisted dev-server allowlist. */
export async function listLiveServers(): Promise<LiveServerTarget[]> {
  const res = await fetch(`${getApiBase()}/api/live-server/list`);
  const body = await res.json();
  return body.success ? (body.data.servers as LiveServerTarget[]) : [];
}

/** Validate (loopback-only) then register a target; returns the proxied path. */
export async function startLiveServer(input: {
  host: string;
  port: number;
  label?: string;
  /** `user` (default, persisted) or `preset` (agent-declared / auto-launch: in-memory only). */
  addedBy?: Exclude<LiveTargetAddedBy, "legacy">;
  /** Session that owns a `preset` target (per-session cap scope). */
  sessionId?: string;
}): Promise<StartResult> {
  const v = validateLiveTarget(input);
  if (!v.ok) return { ok: false, error: v.error };
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/live-server/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
  // Guard `res.json()`: a non-JSON error body (proxy/gateway HTML) would
  // otherwise throw and propagate as an unhandled rejection.
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    return { ok: false, error: body?.error ?? `start failed (${res.status})` };
  }
  return { ok: true, target: body.data };
}

/** Remove a target from the allowlist. */
export async function removeLiveServer(id: string): Promise<void> {
  await fetch(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type CapabilityResult =
  | {
      ok: true;
      path: string;
      expiresAt: number;
      /** Non-secret id of the token (distinct from the secret in `path`); absent on older servers. */
      tokenId?: string;
      /** What the server actually granted (`scripts` may be false when exposed without `runScripts`). */
      policy?: PreviewPolicy;
    }
  | { ok: false; error: string; status?: number };

/** `/live/<id>/~c/<token>/` — the only shape the viewer will frame (never a URL the server merely names). */
const CAPABILITY_PATH = /^\/live\/[A-Za-z0-9_-]+\/~c\/[A-Za-z0-9_-]{22,}\/$/;

/** What the viewer asks for on a mint. The policy is passed on EVERY mint (design D4). */
export interface MintOptions {
  policy?: PreviewPolicy;
  /** Sent only on the operator's "Run scripts" click (and its same-epoch continuation). */
  runScripts?: boolean;
  /** Client-generated id of this viewer instance; scopes allow-once across re-mints. */
  viewerId?: string;
}

function parsePolicy(v: unknown): PreviewPolicy | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { egress, scripts } = v as { egress?: unknown; scripts?: unknown };
  if ((egress !== "open" && egress !== "restricted") || typeof scripts !== "boolean") return undefined;
  return { egress, scripts };
}

/**
 * Mint a per-preview capability path (`control` tier for port targets, raw-read
 * tier for static targets). The preview frame is a sandboxed opaque origin that
 * carries no cookie, so this URL is the credential: it is framed, never displayed
 * or logged. The response is flat (`path`, `expiresAt`, `tokenId`, `policy`), not
 * under `data`.
 * See change: retire-trusted-networks-bypass (D5); improve-canvas-html-and-url-ux (D4).
 */
export async function mintLiveCapability(id: string, opts: MintOptions = {}): Promise<CapabilityResult> {
  const body: Record<string, unknown> = {};
  if (opts.policy) {
    body.egress = opts.policy.egress;
    body.scripts = opts.policy.scripts;
  }
  if (opts.runScripts === true) body.runScripts = true;
  if (opts.viewerId) body.viewerId = opts.viewerId;
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}/capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !accepted(json)) {
    const err = (json as { error?: string } | null)?.error;
    return { ok: false, error: err ?? `capability mint failed (${res.status})`, status: res.status };
  }
  if (typeof json.path !== "string" || !CAPABILITY_PATH.test(json.path) || typeof json.expiresAt !== "number") {
    return { ok: false, error: "capability mint returned an unexpected response" };
  }
  return {
    ok: true,
    path: json.path,
    expiresAt: json.expiresAt,
    tokenId: typeof json.tokenId === "string" ? json.tokenId : undefined,
    policy: parsePolicy(json.policy),
  };
}

// ─── Static targets ─────────────────────────────────────────────────────────

export type StartStaticResult =
  | {
      ok: true;
      id: string;
      /** File path relative to `root`, encoded per segment, no leading slash. */
      entry: string;
      root: string;
    }
  | {
      ok: false;
      error: string;
      /** The refusal response (same status/body as the raw-file gate), when the server answered. */
      response?: Response;
    };

/**
 * Register (or reuse) a static target for a file the raw-read gate admits.
 * `fetchFn` is the surface's provenance fetch, so an agent-opened surface never
 * raises the access-grant dialog (the refusal is classified by the caller).
 */
export async function startStaticTarget(
  cwd: string,
  path: string,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<StartStaticResult> {
  let res: Response;
  try {
    res = await fetchFn(`${getApiBase()}/api/live-server/start-static`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, path }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
  if (!res.ok) return { ok: false, error: `start failed (${res.status})`, response: res };
  const json = await res.json().catch(() => null);
  if (!accepted(json) || typeof json.id !== "string" || typeof json.entry !== "string" || typeof json.root !== "string") {
    return { ok: false, error: "start-static returned an unexpected response" };
  }
  return { ok: true, id: json.id, entry: json.entry, root: json.root };
}

// ─── Exposure policy ────────────────────────────────────────────────────────

export interface LivePolicy {
  exposure: "local-only" | "exposed";
  epoch: number;
  promptingEnabled: boolean;
}

/** `GET /policy` (observe tier). `null` on any failure: callers fail closed (exposed). */
export async function getLivePolicy(): Promise<LivePolicy | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/live-server/policy`);
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    const body = (raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw) as Partial<LivePolicy> | null;
    if (!body || (body.exposure !== "local-only" && body.exposure !== "exposed") || typeof body.epoch !== "number") return null;
    return { exposure: body.exposure, epoch: body.epoch, promptingEnabled: body.promptingEnabled === true };
  } catch {
    return null;
  }
}

/** Extend a token's idle expiry without re-pointing the frame (minting principal only). */
export async function touchLiveCapability(id: string, tokenId: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}/touch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Egress banner data ─────────────────────────────────────────────────────

export interface EgressOrigin {
  origin: string;
  source: "markup" | "runtime";
  state: "blocked" | "allowed-once" | "allowed-project";
  /** Shared-hosting warning. */
  shared?: boolean;
  /** Private / loopback / own origin: no allow controls. */
  ungrantable?: boolean;
}

export interface EgressReport {
  origins: EgressOrigin[];
  scanIncomplete: boolean;
  rootAbsolute: boolean;
  runtimeChannel: boolean;
  promptingEnabled: boolean;
}

/** `GET /:id/egress?token=<tokenId>` (control tier, minting principal only). `null` on failure. */
export async function getLiveEgress(id: string, tokenId: string): Promise<EgressReport | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/live-server/${encodeURIComponent(id)}/egress?token=${encodeURIComponent(tokenId)}`,
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!accepted(json) || !Array.isArray(json.origins)) return null;
    return {
      origins: (json.origins as EgressOrigin[]).filter((o) => typeof o?.origin === "string"),
      scanIncomplete: json.scanIncomplete === true,
      rootAbsolute: json.rootAbsolute === true,
      runtimeChannel: json.runtimeChannel === true,
      promptingEnabled: json.promptingEnabled === true,
    };
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/** Allow one origin for this viewer only (ephemeral; control tier). */
export async function allowOnceEgress(id: string, input: { tokenId: string; viewerId: string; origin: string }): Promise<{ ok: boolean; error?: string }> {
  const r = await postJson(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}/allow-once`, input);
  return r.ok && accepted(r.json) ? { ok: true } : { ok: false, error: (r.json?.error as string | undefined) ?? `allow-once failed (${r.status})` };
}

export type GrantRequestResult = { ok: true } | { ok: false; reason: "prompting-disabled" | "refused" | "rate-limited" | "error"; error?: string };

/** Operator's "Allow for this project" click: records a deferred request and raises the dialog. */
export async function requestEgressGrant(id: string, input: { tokenId: string; origin: string }): Promise<GrantRequestResult> {
  const r = await postJson(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}/egress-grant-request`, input);
  if (r.ok && accepted(r.json)) return { ok: true };
  if (r.json?.reason === "prompting-disabled") return { ok: false, reason: "prompting-disabled" };
  if (r.status === 429) return { ok: false, reason: "rate-limited" };
  if (r.status === 400) return { ok: false, reason: "refused", error: r.json?.error as string | undefined };
  return { ok: false, reason: "error", error: r.json?.error as string | undefined };
}
