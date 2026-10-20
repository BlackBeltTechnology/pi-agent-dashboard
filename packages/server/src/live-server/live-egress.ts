/**
 * Per-token preview egress state: which external origins a restricted preview
 * wants (found in markup by a lazy scan of the HTML it served, or reported by the
 * browser's CSP violation reports), which are allowed (project grant / the
 * viewer's allow-once set), and the CSP `<G>` built from the allowed ones.
 *
 * - The blocked set is per TOKEN and bounded at 64. Eviction removes the oldest
 *   `runtime` entries first and never a markup-detected or an allowed one.
 * - A `runtime` origin comes from a report the PAGE itself can forge, so it is
 *   labelled as such and is never project-grantable (the route layer enforces it).
 * - The CSP report sink is rate limited per token (20/s, 600/h) and reads only
 *   `blocked-uri`; the capability never reaches a log line (`liveLog` redacts).
 *
 * See change: improve-canvas-html-and-url-ux (design D6, D7; tasks 2.7-2.9, 2.11, 3.3).
 */
import type { StaticTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { canonicalHttpsOrigin, isUngrantableEgressOrigin } from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import type { LiveCapabilityGrant } from "./live-capability.js";
import { type ScanOutcome, scanHtmlFile, scanStillValid } from "./live-origin-scan.js";

/** The per-token blocked-set bound (markup + runtime). */
export const MAX_BLOCKED_ORIGINS = 64;
/** HTML documents remembered per token for scanning. */
const MAX_SERVED_DOCS = 8;
/** Token states kept (oldest dropped). */
const MAX_TOKEN_STATES = 512;
const MAX_SCAN_CACHE = 64;
/** CSP report limits per token (decision C4). */
export const CSP_REPORT_MAX_BYTES = 64 * 1024;
const CSP_REPORTS_PER_SECOND = 20;
const CSP_REPORTS_PER_HOUR = 600;
/** Reports read from one body (a Reporting API batch). */
const MAX_REPORTS_PER_BODY = 20;

/** Hosts that serve content anyone can publish: a grant for one trusts every tenant. */
const SHARED_HOSTING = [
  "github.io",
  "pages.dev",
  "netlify.app",
  "vercel.app",
  "workers.dev",
  "glitch.me",
  "repl.co",
  "trycloudflare.com",
  "ngrok-free.app",
  "ngrok.io",
  "onrender.com",
  "fly.dev",
  "surge.sh",
  "share.zrok.io",
] as const;

const isSharedHostingOrigin = (origin: string): boolean => {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return SHARED_HOSTING.some((d) => host === d || host.endsWith(`.${d}`));
};

interface EgressOriginView {
  origin: string;
  source: "markup" | "runtime";
  state: "blocked" | "allowed-once" | "allowed-project";
  shared?: boolean;
  ungrantable?: boolean;
}

interface EgressView {
  origins: EgressOriginView[];
  scanIncomplete: boolean;
  rootAbsolute: boolean;
  runtimeChannel: boolean;
}

export interface PreviewEgressDeps {
  getStatic(id: string): StaticTarget | undefined;
  /** The project a working directory belongs to (git common root, else cwd). Cached here. */
  projectKeyOf(cwd: string): string;
  /** Origins granted for a project (read live: a revoke applies on the next call). */
  projectGrants(projectKey: string): readonly string[];
  /** The viewer's allow-once set. */
  allowOnce(viewerId: string | undefined): readonly string[];
  /** The dashboard's own origins (tunnels, public base URLs, …): never grantable. */
  ownOrigins?(): readonly string[];
  now?(): number;
}

interface TokenState {
  /** Real paths of HTML documents served under this token, oldest first. */
  served: string[];
  /** Runtime-reported origins, insertion-ordered (oldest first). */
  runtime: Set<string>;
  reports: number;
  /** Timestamps (ms) of accepted reports in the last second. */
  recent: number[];
  hourStart: number;
  hourCount: number;
}

type ReportOutcome = "ok" | "rate-limited";

/**
 * Pull the blocked URLs out of a CSP report body: the legacy
 * `{"csp-report":{"blocked-uri":…}}` (`application/csp-report`) and the Reporting API
 * array `[{type:"csp-violation",body:{blockedURL:…}}]` (`application/reports+json`).
 * Nothing else in the body is read.
 */
function blockedUrisOf(body: unknown): string[] {
  const out: string[] = [];
  const one = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    const rec = item as Record<string, unknown>;
    const inner = (rec["csp-report"] ?? rec.body ?? rec) as Record<string, unknown> | undefined;
    if (!inner || typeof inner !== "object") return;
    const uri = inner["blocked-uri"] ?? inner.blockedURL ?? inner["blocked-url"];
    if (typeof uri === "string" && uri.length > 0 && uri.length <= 2048) out.push(uri);
  };
  if (Array.isArray(body)) for (const item of body.slice(0, MAX_REPORTS_PER_BODY)) one(item);
  else one(body);
  return out;
}

/** A blocked URL as a listable origin (`https://…` canonical, `http://…` as-is), or `null` (inline, data, own, …). */
function listedOriginOf(blockedUri: string): string | null {
  let u: URL;
  try {
    u = new URL(blockedUri);
  } catch {
    return null;
  }
  if (u.protocol === "https:") return canonicalHttpsOrigin(u.origin);
  if (u.protocol === "http:") return u.origin;
  return null;
}

/** The dashboard origin a request reached us on (`scheme://Host`), as far as this hop can tell. */
export function requestOriginsOf(request: { protocol?: string; headers: Record<string, unknown> }): string[] {
  const host = request.headers.host;
  if (typeof host !== "string" || !/^[A-Za-z0-9.\-[\]:]+$/.test(host)) return [];
  const scheme = request.protocol === "https" ? "https" : "http";
  return [`${scheme}://${host.toLowerCase()}`];
}

export interface PreviewEgress {
  /** Remember that `realPath` (an HTML document) was served under this token. */
  noteServed(grant: LiveCapabilityGrant, realPath: string): void;
  /** The origins view for the token (scans lazily). `own`: extra dashboard origins (the request's). */
  view(grant: LiveCapabilityGrant, opts?: { own?: readonly string[]; promptable?: boolean }): Promise<EgressView>;
  /** Markup-detected origins of the token (scans lazily). */
  markupOrigins(grant: LiveCapabilityGrant): Promise<string[]>;
  /** CSP `<G>`: project grants ∪ the viewer's allow-once set. */
  grantedFor(grant: LiveCapabilityGrant): string[];
  /** The project a token belongs to (a static target's cwd project), or `null` for a port target. */
  projectKeyFor(grant: LiveCapabilityGrant): string | null;
  /** Record a CSP report body for the token (rate limited). */
  report(grant: LiveCapabilityGrant, body: unknown, own?: readonly string[]): ReportOutcome;
  /** Is the origin grantable at all (https, public, not the dashboard's own)? */
  isGrantable(origin: string, own?: readonly string[]): boolean;
}

/** Per-token report limits: 20 in any second, 600 in an hour. Counts the report when admitted. */
function admitReport(state: TokenState, t: number): boolean {
  state.recent = state.recent.filter((x) => t - x < 1000);
  if (state.recent.length >= CSP_REPORTS_PER_SECOND) return false;
  if (t - state.hourStart >= 3_600_000) {
    state.hourStart = t;
    state.hourCount = 0;
  }
  if (state.hourCount >= CSP_REPORTS_PER_HOUR) return false;
  state.recent.push(t);
  state.hourCount++;
  state.reports++;
  return true;
}

/** Add the report's blocked origins as `runtime` entries, bounded: evict the oldest not-allowed one first. */
function recordRuntimeOrigins(state: TokenState, body: unknown, ownList: readonly string[], allowed: ReadonlySet<string>): void {
  for (const uri of blockedUrisOf(body)) {
    const origin = listedOriginOf(uri);
    // The dashboard's own origin is not an egress target.
    if (!origin || ownList.includes(origin)) continue;
    state.runtime.delete(origin); // re-insert: most recently seen last
    state.runtime.add(origin);
  }
  while (state.runtime.size > MAX_BLOCKED_ORIGINS) {
    const victim = [...state.runtime].find((o) => !allowed.has(o));
    if (victim === undefined) break;
    state.runtime.delete(victim);
  }
}

export function createPreviewEgress(deps: PreviewEgressDeps): PreviewEgress {
  const now = deps.now ?? Date.now;
  const states = new Map<string, TokenState>();
  const scans = new Map<string, ScanOutcome>();
  const projectKeys = new Map<string, string>();

  const stateOf = (tokenId: string): TokenState => {
    let s = states.get(tokenId);
    if (s) {
      states.delete(tokenId);
    } else {
      s = { served: [], runtime: new Set(), reports: 0, recent: [], hourStart: now(), hourCount: 0 };
    }
    states.set(tokenId, s);
    while (states.size > MAX_TOKEN_STATES) {
      const oldest = states.keys().next().value;
      if (oldest === undefined) break;
      states.delete(oldest);
    }
    return s;
  };

  const own = (extra?: readonly string[]): readonly string[] => [...(deps.ownOrigins?.() ?? []), ...(extra ?? [])];

  const projectKeyFor = (grant: LiveCapabilityGrant): string | null => {
    const target = deps.getStatic(grant.targetId);
    if (!target) return null;
    let key = projectKeys.get(target.cwd);
    if (key === undefined) {
      try {
        key = deps.projectKeyOf(target.cwd);
      } catch {
        key = target.cwd;
      }
      projectKeys.set(target.cwd, key);
      while (projectKeys.size > 256) {
        const oldest = projectKeys.keys().next().value;
        if (oldest === undefined) break;
        projectKeys.delete(oldest);
      }
    }
    return key;
  };

  const grantedFor = (grant: LiveCapabilityGrant): string[] => {
    const project = projectKeyFor(grant);
    const projectGrants = project ? deps.projectGrants(project) : [];
    return [...new Set([...projectGrants, ...deps.allowOnce(grant.viewerId)])];
  };

  const scanFile = async (root: string, file: string): Promise<ScanOutcome> => {
    const cached = scans.get(file);
    if (cached && (await scanStillValid(cached))) {
      scans.delete(file);
      scans.set(file, cached);
      return cached;
    }
    const fresh = await scanHtmlFile(root, file);
    scans.delete(file);
    scans.set(file, fresh);
    while (scans.size > MAX_SCAN_CACHE) {
      const oldest = scans.keys().next().value;
      if (oldest === undefined) break;
      scans.delete(oldest);
    }
    return fresh;
  };

  /** Union of the scans of every document served under the token. */
  const scanToken = async (
    grant: LiveCapabilityGrant,
  ): Promise<{ origins: string[]; incomplete: boolean; rootAbsolute: boolean }> => {
    const target = deps.getStatic(grant.targetId);
    const state = states.get(grant.tokenId);
    const result = { origins: [] as string[], incomplete: false, rootAbsolute: false };
    if (!target || !state) return result;
    const seen = new Set<string>();
    for (const file of [...state.served]) {
      const out = await scanFile(target.root, file);
      for (const o of out.origins) seen.add(o);
      if (out.incomplete) result.incomplete = true;
      if (out.rootAbsolute) result.rootAbsolute = true;
    }
    result.origins = [...seen];
    return result;
  };

  return {
    noteServed(grant, realPath) {
      const s = stateOf(grant.tokenId);
      const i = s.served.indexOf(realPath);
      if (i >= 0) s.served.splice(i, 1);
      s.served.push(realPath);
      while (s.served.length > MAX_SERVED_DOCS) s.served.shift();
    },

    async view(grant, opts = {}) {
      const state = stateOf(grant.tokenId);
      const scan = await scanToken(grant);
      const ownList = own(opts.own);
      const project = projectKeyFor(grant);
      const projectSet = new Set(project ? deps.projectGrants(project) : []);
      const onceSet = new Set(deps.allowOnce(grant.viewerId));
      const stateOfOrigin = (o: string): EgressOriginView["state"] =>
        projectSet.has(o) ? "allowed-project" : onceSet.has(o) ? "allowed-once" : "blocked";
      const isAllowed = (o: string): boolean => projectSet.has(o) || onceSet.has(o);

      const markup = scan.origins.slice(0, MAX_BLOCKED_ORIGINS);
      const incomplete = scan.incomplete || scan.origins.length > MAX_BLOCKED_ORIGINS;
      const markupSet = new Set(markup);
      // Runtime entries: not already in markup; oldest evicted first, never an allowed one.
      const runtime = [...state.runtime].filter((o) => !markupSet.has(o));
      let over = markup.length + runtime.length - MAX_BLOCKED_ORIGINS;
      for (let i = 0; i < runtime.length && over > 0; ) {
        if (isAllowed(runtime[i])) {
          i++;
          continue;
        }
        state.runtime.delete(runtime[i]);
        runtime.splice(i, 1);
        over--;
      }
      // Allowed-once origins the page no longer asks for (reload after allowing) stay visible.
      const listed = new Set([...markup, ...runtime]);
      const extras = [...onceSet].filter((o) => !listed.has(o));
      const rows: EgressOriginView[] = [
        ...markup.map((o) => ({ origin: o, source: "markup" as const })),
        ...runtime.map((o) => ({ origin: o, source: "runtime" as const })),
        ...extras.map((o) => ({ origin: o, source: "runtime" as const })),
      ].map(({ origin, source }) => {
        const ungrantable = isUngrantableEgressOrigin(origin, ownList);
        return {
          origin,
          source,
          state: stateOfOrigin(origin),
          ...(isSharedHostingOrigin(origin) ? { shared: true } : {}),
          ...(ungrantable ? { ungrantable: true } : {}),
        };
      });
      return {
        origins: rows,
        scanIncomplete: incomplete,
        rootAbsolute: scan.rootAbsolute,
        runtimeChannel: state.reports > 0,
      };
    },

    async markupOrigins(grant) {
      return (await scanToken(grant)).origins;
    },

    grantedFor,
    projectKeyFor,

    report(grant, body, ownExtra) {
      const state = stateOf(grant.tokenId);
      if (!admitReport(state, now())) return "rate-limited";
      recordRuntimeOrigins(state, body, own(ownExtra), new Set(grantedFor(grant)));
      return "ok";
    },

    isGrantable(origin, ownExtra) {
      return !isUngrantableEgressOrigin(origin, own(ownExtra));
    },
  };
}

/** How a `POST /:id/egress-grant-request` ended (the registry's decision, in the route's terms). */
export type EgressGrantRequestOutcome =
  | "raised"
  | "prompting-disabled"
  | "rate-limited"
  | "not-promptable"
  | "unavailable";

/** Map the coordinator's denial reason for a deferred request onto the route's outcome. */
function outcomeOfDenialReason(reason: string): EgressGrantRequestOutcome {
  switch (reason) {
    // The entry was recorded and the dialog raised (a deferred request is never held).
    case "not-held":
      return "raised";
    case "disabled":
    case "report-mode":
    case "no-audience":
    case "ineligible":
      return "prompting-disabled";
    case "not-promptable":
      return "not-promptable";
    case "capacity":
    case "channel-share":
    case "deferred-share":
    case "backoff":
    case "plane-rate":
    case "channel-rate":
    case "concurrent-cap":
    case "channel-concurrent":
      return "rate-limited";
    default:
      return "unavailable";
  }
}

/** The slice of the grant coordinator the requester needs. */
interface DenialSink {
  onDenial(
    ctx: {
      plane: "preview-egress";
      rawSubject: string;
      origin: string;
      channel: string;
      requestHoldsCapability: boolean;
    },
    holdable: boolean,
  ): { result: Promise<{ kind: string; reason?: string }> };
}

/**
 * Build the `requestEgressGrant` dependency of the route: records a deferred
 * `(preview-egress, origin)` registry entry charged to `channel` (the requesting
 * browser's source) and raises the standard dialog, with the project key as the
 * audit origin the plane's `grant` writes under.
 */
export function createEgressGrantRequester(coordinator: DenialSink) {
  return async (input: { origin: string; projectKey: string; channel: string }): Promise<EgressGrantRequestOutcome> => {
    const hold = coordinator.onDenial(
      {
        plane: "preview-egress",
        rawSubject: input.origin,
        origin: input.projectKey,
        channel: input.channel,
        requestHoldsCapability: false,
      },
      false,
    );
    const res = await hold.result;
    return res.kind === "deny" ? outcomeOfDenialReason(res.reason ?? "") : "unavailable";
  };
}
