/**
 * Shared product tool runtime (design D11): every `<product>_*` tool is declared as a small spec and this file
 * owns what is common to all of them, in one fixed order —
 *   account present → params parsed → account resolved (alias → unique email → `ambiguous`/`not_found`) →
 *   product/level gate (`product_disabled` / `level_insufficient`, before any HTTP and before any dialog) →
 *   reads: lease → run;
 *   writes: no-UI block → `prepare` (read-only lookups) → host confirm → FRESH lease → run.
 * One lease per call over `google/lease` with the tool's product and level; its level is re-checked here.
 * Reads carry `details.untrusted`; writes confirm themselves (declared `selfConfirming` to the content guard).
 * See change: add-google-connect.
 */
import { type PluginLaneReply, requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { apiBase } from "../shared/api-hosts.js";
import { type GoogleEndpoints, resolveGoogleEndpoints } from "../shared/endpoints.js";
import { SERVICES } from "../shared/google-errors.js";
import { isLevel, levelAtLeast, type Product } from "../shared/products.js";
import type { LeaseReply } from "../shared/protocol.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../shared/protocol.js";
import { GoogleApi } from "./google-http.js";
import { joinSummary } from "./preview.js";
import { GoogleToolError, invalidParams } from "./tool-error.js";

const PLUGIN_ID = "google";
/** A confirm that nobody answers must not hold a tool call forever. */
export const CONFIRM_TIMEOUT_MS = 300_000;
const SETTINGS = "Settings \u2192 Google accounts";

export type LaneRequest = (pluginId: string, type: string, payload?: unknown) => Promise<PluginLaneReply>;

export interface ToolContext {
  cwd?: string;
  hasUI?: boolean;
  ui?: {
    confirm(title: string, message: string, opts?: unknown): Promise<boolean>;
    /** Text prompt (`gdrive_pick` answers through it); absent on hosts without it. */
    input?(title: string, placeholder?: string, opts?: unknown): Promise<string | undefined>;
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: ToolContext): Promise<ToolResult>;
}

/** What a tool returns: compact JSON (reads) or plain text, plus optional `details`. */
export type ToolOutput = { json: unknown; details?: Record<string, unknown> } | { text: string; details?: Record<string, unknown> };

/** Returned by `prepare` to end a write without confirming or changing anything (e.g. "0 matches"). */
export class Skip {
  readonly output: ToolOutput;
  constructor(output: ToolOutput) {
    this.output = output;
  }
}

/** A connected account as the tool sees it. */
export interface ResolvedAccount {
  sub: string;
  email: string;
  alias?: string;
}

/** Handed to `prepare` and `run`: the leased account, a ready REST client and the host context. */
export interface Call {
  account: ResolvedAccount;
  lease: LeaseReply;
  api: GoogleApi;
  ctx?: ToolContext;
  signal?: AbortSignal;
}

export interface ToolSpec<P, S = undefined> {
  name: string;
  label: string;
  description: string;
  /** JSON-schema `properties` WITHOUT `account` (added to every tool, required) and `required` names WITHOUT it. */
  properties: Record<string, unknown>;
  required?: string[];
  /** Minimum product level, one of the product's levels in `shared/products.ts`. */
  level: string;
  /** Writes are confirmed first. */
  write?: true;
  /** Pure validation; throws `invalidParams`. Runs before any lane or HTTP call. */
  parse(params: Record<string, unknown>): P;
  /** Writes only. Read-only lookups before the dialog (no write request); may end the call with `new Skip(...)`. */
  prepare?(p: P, call: Call): Promise<S | Skip>;
  /** Writes only. Dialog lines (`Account:` is added); each product-specific field, bounded via `preview.ts`. */
  summary?(p: P, state: S, account: ResolvedAccount): string[];
  run(p: P, call: Call, state: S): Promise<ToolOutput>;
}

export interface ProductRuntime {
  readonly product: Product;
  define<P, S = undefined>(spec: ToolSpec<P, S>): ToolDef;
}

/** One product's tools. Add a product = one file under `tools/` exporting one of these + one line in `tools/index.ts`. */
export interface ProductTools {
  product: Product;
  create(rt: ProductRuntime): ToolDef[];
}

export interface RuntimeDeps {
  request?: LaneRequest;
  endpoints?: GoogleEndpoints;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Per-HTTP-attempt timeout (tests shorten it). */
  timeoutMs?: number;
  confirmTimeoutMs?: number;
}

interface AccountRow {
  sub: string;
  email: string;
  alias?: string;
  status?: string;
  products?: Partial<Record<string, { level?: string }>>;
}

const labelOf = (a: { email: string; alias?: string }): string => (a.alias ? `${a.alias} (${a.email})` : a.email);

function laneError(error: string): GoogleToolError {
  const m = /^([a-z_]{1,64}): ([\s\S]*)$/.exec(error);
  if (m) return new GoogleToolError(m[1] as string, `${m[1]}: ${m[2]}`);
  if (error === "unavailable") return new GoogleToolError("unavailable", "the pi-dashboard is not connected; Google tools need it");
  return new GoogleToolError(error.slice(0, 64) || "lane_error", `Google lease failed: ${error.slice(0, 200)}`);
}

/** A confirmed write needs an interactive UI; checked before anything reaches Google. */
function assertInteractive(ctx: ToolContext | undefined, label: string): void {
  if (!ctx?.hasUI || !ctx.ui) {
    throw new GoogleToolError("blocked", `blocked: this ${label} change needs user confirmation, but no UI is available`);
  }
}

/** Host confirm dialog. No UI → `blocked`; deny / dismiss / throw / timeout → `denied`. Resolves only on an explicit allow. */
export async function confirmWrite(
  ctx: ToolContext | undefined,
  title: string,
  summary: string | readonly string[],
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<void> {
  assertInteractive(ctx, title.split(":")[0] ?? "Google");
  const ui = (ctx as ToolContext).ui as NonNullable<ToolContext["ui"]>;
  const message = typeof summary === "string" ? summary : joinSummary(summary);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("timeout");
  let answer: unknown = false;
  try {
    const expiry = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), timeoutMs);
    });
    answer = await Promise.race([ui.confirm(title, message, { timeout: timeoutMs }), expiry]);
  } catch {
    answer = false; // dismissed / transport error → deny
  } finally {
    clearTimeout(timer);
  }
  if (answer === timedOut) throw new GoogleToolError("denied", "denied: the confirmation timed out; nothing was changed");
  if (answer !== true) throw new GoogleToolError("denied", `denied: the user did not approve this ${title.split(":")[0] ?? "Google"} action; nothing was changed`);
}

export interface Runtime {
  forProduct(product: Product): ProductRuntime & { readonly reads: string[]; readonly writes: string[] };
}

export function createRuntime(deps: RuntimeDeps = {}): Runtime {
  const request = deps.request ?? requestPluginServer;
  const endpoints = deps.endpoints ?? resolveGoogleEndpoints();

  async function accounts(): Promise<AccountRow[]> {
    const reply = await request(PLUGIN_ID, ACCOUNTS_TYPE, {});
    if (!reply.ok) throw laneError(reply.error);
    return Array.isArray(reply.result) ? (reply.result as AccountRow[]) : [];
  }

  /** Alias first (case-insensitive), then email (case-insensitive); several matches → `ambiguous`, none → `not_found`. */
  async function resolve(ref: string): Promise<AccountRow> {
    const list = await accounts();
    const needle = ref.trim().toLowerCase();
    const byAlias = list.filter((a) => a.alias?.toLowerCase() === needle);
    const hits = byAlias.length ? byAlias : list.filter((a) => a.email.toLowerCase() === needle);
    if (hits.length === 1) return hits[0] as AccountRow;
    if (hits.length > 1) {
      throw new GoogleToolError("ambiguous", `ambiguous: "${ref}" matches ${hits.map((a) => `${labelOf(a)} [${a.sub}]`).join(", ")}; set an alias on each in ${SETTINGS} and use the alias`);
    }
    throw new GoogleToolError("not_found", `not_found: No connected Google account matches "${ref}". Known accounts: ${list.map(labelOf).join(", ") || "none connected"}.`);
  }

  async function requireAccountArg(params: Record<string, unknown>): Promise<string> {
    const a = params.account;
    if (typeof a === "string" && a.trim()) return a.trim();
    let known = "none connected";
    try {
      const list = await accounts();
      if (list.length) known = list.map(labelOf).join(", ");
    } catch {
      known = "unavailable";
    }
    throw invalidParams(`\`account\` is required (alias or email). Connected accounts: ${known}`);
  }

  /** Product on and high enough — from the account list, before any lease, dialog or HTTP call. */
  function gate(product: Product, level: string, acct: AccountRow): void {
    const label = SERVICES[product].label;
    const sel = acct.products?.[product];
    if (!sel) throw new GoogleToolError("product_disabled", `product_disabled: ${label} is off for ${acct.email} in ${SETTINGS}`);
    if (typeof sel.level !== "string" || !isLevel(product, sel.level) || !levelAtLeast(product, sel.level, level)) {
      throw new GoogleToolError("level_insufficient", `level_insufficient: ${label} is set to "${sel.level}" for ${acct.email}; this tool needs "${level}" - raise it in ${SETTINGS}`);
    }
  }

  async function lease(product: Product, level: string, acct: AccountRow): Promise<LeaseReply> {
    const reply = await request(PLUGIN_ID, LEASE_TYPE, { account: acct.sub, product, level });
    if (!reply.ok) throw laneError(reply.error);
    const r = reply.result as Partial<LeaseReply> | null;
    if (!r || typeof r.accessToken !== "string" || typeof r.email !== "string" || typeof r.level !== "string") {
      throw new GoogleToolError("bad_lease", "bad_lease: the Google lease reply was malformed");
    }
    if (!isLevel(product, r.level) || !levelAtLeast(product, r.level, level)) {
      throw new GoogleToolError("level_insufficient", `level_insufficient: ${SERVICES[product].label} is set to "${r.level}" for ${r.email}; this tool needs "${level}" - raise it in ${SETTINGS}`);
    }
    return r as LeaseReply;
  }

  async function openCall(product: Product, level: string, acct: AccountRow, ctx?: ToolContext, signal?: AbortSignal): Promise<Call> {
    const l = await lease(product, level, acct);
    const api = new GoogleApi({
      product,
      level,
      base: apiBase(product, endpoints),
      token: l.accessToken,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.random ? { random: deps.random } : {}),
      ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
      ...(signal ? { signal } : {}),
    });
    return { account: { sub: acct.sub, email: l.email, ...(acct.alias ? { alias: acct.alias } : {}) }, lease: l, api, ...(ctx ? { ctx } : {}), ...(signal ? { signal } : {}) };
  }

  function finish(out: ToolOutput, email: string, untrusted: boolean): ToolResult {
    const text = "json" in out ? JSON.stringify(out.json) : out.text;
    return { content: [{ type: "text", text }], details: { account: email, ...(untrusted ? { untrusted: true } : {}), ...out.details } };
  }

  return {
    forProduct(product) {
      const reads: string[] = [];
      const writes: string[] = [];
      const label = SERVICES[product].label;
      return {
        product,
        reads,
        writes,
        define<P, S = undefined>(spec: ToolSpec<P, S>): ToolDef {
          (spec.write ? writes : reads).push(spec.name);
          return {
            name: spec.name,
            label: spec.label,
            description: spec.description,
            parameters: {
              type: "object",
              properties: {
                account: { type: "string", minLength: 1, description: "Account alias or email address. Required." },
                ...spec.properties,
              },
              required: ["account", ...(spec.required ?? [])],
              additionalProperties: false,
            },
            async execute(_id, params, signal, _update, ctx) {
              const p = params ?? {};
              const ref = await requireAccountArg(p);
              const args = spec.parse(p);
              const acct = await resolve(ref);
              gate(product, spec.level, acct);
              if (!spec.write) return finish(await spec.run(args, await openCall(product, spec.level, acct, ctx, signal), undefined as S), acct.email, true);

              assertInteractive(ctx, label);
              let state = undefined as S;
              if (spec.prepare) {
                const prepared = await spec.prepare(args, await openCall(product, spec.level, acct, ctx, signal));
                if (prepared instanceof Skip) return finish(prepared.output, acct.email, false);
                state = prepared;
              }
              const lines = [`Account: ${acct.email}`, ...(spec.summary ? spec.summary(args, state, acct) : [])];
              await confirmWrite(ctx, `${label}: ${spec.label}`, lines, deps.confirmTimeoutMs);
              return finish(await spec.run(args, await openCall(product, spec.level, acct, ctx, signal), state), acct.email, false);
            },
          };
        },
      };
    },
  };
}

/** Build the tools of every listed product; `reads` / `writes` feed the content-guard declarations. */
export function buildTools(runtime: Runtime, products: readonly ProductTools[]): { tools: ToolDef[]; reads: string[]; writes: string[] } {
  const out = { tools: [] as ToolDef[], reads: [] as string[], writes: [] as string[] };
  for (const p of products) {
    const rt = runtime.forProduct(p.product);
    out.tools.push(...p.create(rt));
    out.reads.push(...rt.reads);
    out.writes.push(...rt.writes);
  }
  return out;
}
