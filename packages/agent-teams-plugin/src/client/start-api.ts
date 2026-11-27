/**
 * REST client of the templates-hooks UI (lazy modules only; no React): template
 * listing, team start and plan decision, all through the page's own `fetch`.
 * Every answer is normalised to `{ ok, … }` — the server's `{ error, message?,
 * details? }` body becomes a `RestFailure`; a thrown fetch (offline, aborted)
 * becomes `network: true`. Nothing here retries: a retry is always a user action.
 * See change: add-agent-teams-templates-hooks (design D11).
 */
import type { HooksUntrustedDetails, TemplateSummary } from "../shared/protocol.js";
import { TEAMS_API } from "./routes.js";

export interface RestFailure {
  status: number;
  /** The server's error code (`hooks_untrusted`, `already_decided`, …). */
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  /** The request never produced an answer (offline, aborted, timed out). */
  network?: boolean;
}
export type RestResult<T> = { ok: true; status: number; data: T } | { ok: false; failure: RestFailure };

export interface RequestOptions {
  signal?: AbortSignal;
  /** Test seam; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function requestJson<T>(url: string, init: RequestInit, opts: RequestOptions): Promise<RestResult<T>> {
  const fetchFn = opts.fetch ?? ((input: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(input, i));
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: opts.signal });
  } catch {
    return { ok: false, failure: { status: 0, network: true } };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined; // empty or non-JSON body: no code, no data
  }
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  const rec = isRecord(body) ? body : {};
  // `details` is the contract; a flat `{ error, hash, commands }` body is tolerated.
  const details = isRecord(rec.details) ? rec.details : typeof rec.hash === "string" ? rec : undefined;
  return {
    ok: false,
    failure: {
      status: res.status,
      code: typeof rec.error === "string" ? rec.error : undefined,
      message: typeof rec.message === "string" ? rec.message : undefined,
      details,
    },
  };
}

const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface TemplateListing {
  templates: TemplateSummary[];
  warnings: string[];
}

export async function listTemplates(cwd: string, opts: RequestOptions = {}): Promise<RestResult<TemplateListing>> {
  const res = await requestJson<{ templates?: unknown; warnings?: unknown }>(`${TEAMS_API}/templates?cwd=${encodeURIComponent(cwd)}`, { method: "GET" }, opts);
  if (!res.ok) return res;
  const templates = Array.isArray(res.data?.templates) ? (res.data.templates as TemplateSummary[]) : [];
  const warnings = Array.isArray(res.data?.warnings) ? res.data.warnings.filter((w): w is string => typeof w === "string") : [];
  return { ok: true, status: res.status, data: { templates, warnings } };
}

export interface StartRequest {
  template: string;
  goal: string;
  cwd: string;
  /** The hash the user was shown in a `hooks_untrusted` answer. */
  trustHooks?: string;
}

export function startTeam(req: StartRequest, opts: RequestOptions = {}): Promise<RestResult<{ teamId?: string }>> {
  const body: StartRequest = req.trustHooks === undefined ? { template: req.template, goal: req.goal, cwd: req.cwd } : req;
  return requestJson(`${TEAMS_API}/teams/start`, jsonPost(body), opts);
}

/** The commands + hash of a `hooks_untrusted` answer, or `undefined` when the details are malformed. */
export function hooksDetailsOf(failure: RestFailure): HooksUntrustedDetails | undefined {
  const d = failure.details;
  if (!d || typeof d.hash !== "string" || !Array.isArray(d.commands)) return undefined;
  const commands: HooksUntrustedDetails["commands"] = [];
  for (const c of d.commands) {
    if (!isRecord(c) || typeof c.command !== "string") return undefined;
    commands.push({ event: typeof c.event === "string" ? c.event : "", command: c.command, ...(typeof c.timeoutMs === "number" ? { timeoutMs: c.timeoutMs } : {}) });
  }
  return { hash: d.hash, commands };
}

export interface PlanDecisionRequest {
  planId: string;
  approve: boolean;
  feedback?: string;
}

export function decidePlan(teamId: string, member: string, req: PlanDecisionRequest, opts: RequestOptions = {}): Promise<RestResult<unknown>> {
  const url = `${TEAMS_API}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(member)}/plan-decision`;
  const body: PlanDecisionRequest = req.feedback ? req : { planId: req.planId, approve: req.approve };
  return requestJson(url, jsonPost(body), opts);
}
