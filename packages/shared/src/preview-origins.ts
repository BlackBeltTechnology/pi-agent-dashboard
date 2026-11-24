/**
 * `liveServer.previewOrigins` — pure parse + overlap validation (D12, D5).
 *
 * Two layers, both pure and browser-safe (no node imports):
 *   - {@link parsePreviewOrigins}: shape + syntax only. Invalid tiers are dropped
 *     one at a time (never the whole block) and reported as `issues`. Run by
 *     `loadConfig()`, which every bridge process also executes, so it must not
 *     need server state.
 *   - {@link resolvePreviewOrigins}: overlap checks that need live server state
 *     (ports, allowed hosts, tunnels, TLS names, static admission rows). Run by
 *     the server's config snapshot on every config/tunnel change.
 *
 * Never throws: a bad value disables its tier, tiers 1 and 5 stay available.
 * See change: serve-live-previews-on-capability-origin (D12).
 */

const KEY = "liveServer.previewOrigins";
const K = {
  root: KEY,
  enabled: `${KEY}.enabled`,
  wildcard: `${KEY}.wildcard`,
  suffix: `${KEY}.wildcard.suffix`,
  forHosts: `${KEY}.wildcard.forHosts`,
  scheme: `${KEY}.wildcard.scheme`,
  port: `${KEY}.wildcard.port`,
  portPool: `${KEY}.portPool`,
  ipDnsSuffix: `${KEY}.ipDnsSuffix`,
} as const;

/** Maximum ports in the tier-3 pool (P4 cap). */
export const PREVIEW_POOL_MAX_PORTS = 100;
/** Length of a base32 capability label (160-bit token id → 26 chars, D2). */
export const PREVIEW_LABEL_LENGTH = 26;
const LABEL_SHAPE = /^[a-z2-7]{26}$/;

export interface PreviewWildcardConfig {
  suffix: string;
  forHosts: string[];
  scheme: "https" | "http";
  /** Elided when equal to the scheme default, so `originHost` equals the browser's Host. */
  port?: number;
}

/** Validated, normalised shape stored in `DashboardConfig.liveServer.previewOrigins`. */
export interface PreviewOriginsConfig {
  enabled: boolean;
  wildcard?: PreviewWildcardConfig;
  portPool?: string;
  ipDnsSuffix?: string;
}

export interface PreviewOriginsIssue {
  /** Config keys the line names (two for the suffix-collision line). */
  keys: string[];
  message: string;
}

export interface ParsedPreviewOrigins {
  value: PreviewOriginsConfig;
  issues: PreviewOriginsIssue[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Lower-case and strip ONE trailing dot (Q14). */
export function normalizePreviewHost(s: string): string {
  const lower = s.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

const LDH_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Returns the normalised suffix, or a reason string when it is not a valid DNS suffix. */
function checkSuffix(raw: string): { ok: true; suffix: string } | { ok: false; reason: string } {
  const s = normalizePreviewHost(raw);
  if (!s) return { ok: false, reason: "is empty" };
  if (/[:/*@\s]/.test(s)) return { ok: false, reason: "must be a bare DNS name (no scheme, port, path or `*.`)" };
  if (IPV4.test(s) || s.includes(":")) return { ok: false, reason: "must not be an IP literal" };
  const labels = s.split(".");
  if (labels.some((l) => l === "")) return { ok: false, reason: "has an empty label" };
  if (labels.some((l) => !LDH_LABEL.test(l) || l.length > 63)) return { ok: false, reason: "has an invalid DNS label" };
  if (s === "localhost" || s.endsWith(".localhost")) {
    return { ok: false, reason: "must not be or end in `localhost` (resolves to loopback)" };
  }
  return { ok: true, suffix: s };
}

/** Bare host (no scheme/port/path) for `forHosts` entries. */
function checkForHost(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = normalizePreviewHost(raw);
  if (!s || /[:/*@\s]/.test(s) || IPV4.test(s)) return undefined;
  const labels = s.split(".");
  if (labels.some((l) => !LDH_LABEL.test(l))) return undefined;
  return s;
}

interface PoolRange {
  from: number;
  to: number;
}

/** Strict `a-b` grammar (Q15). Returns the range or a reason. */
export function parsePortPool(raw: string): { ok: true; range: PoolRange } | { ok: false; reason: string } {
  const m = /^([1-9]\d*)-([1-9]\d*)$/.exec(raw);
  if (!m) return { ok: false, reason: "must be `a-b` (integers, no whitespace or leading zeros)" };
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from < 1024) return { ok: false, reason: "ports must be >= 1024" };
  if (to > 65535) return { ok: false, reason: "ports must be <= 65535" };
  if (from > to) return { ok: false, reason: "range is inverted" };
  if (to - from + 1 > PREVIEW_POOL_MAX_PORTS) return { ok: false, reason: `range exceeds ${PREVIEW_POOL_MAX_PORTS} ports` };
  return { ok: true, range: { from, to } };
}

function parseWildcard(raw: unknown, issues: PreviewOriginsIssue[]): PreviewWildcardConfig | undefined {
  const bad = (key: string, why: string): undefined => {
    issues.push({ keys: [key], message: `${key} ${why}; tier 2 (wildcard) disabled` });
    return undefined;
  };
  if (!isRecord(raw)) return bad(K.wildcard, "must be an object");
  if (typeof raw.suffix !== "string") return bad(K.suffix, "must be a string");
  const suffix = checkSuffix(raw.suffix);
  if (!suffix.ok) return bad(K.suffix, suffix.reason);
  if (!Array.isArray(raw.forHosts) || raw.forHosts.length === 0) {
    return bad(K.forHosts, "must be a non-empty array of dashboard host names (no default)");
  }
  const forHosts: string[] = [];
  for (const entry of raw.forHosts) {
    const host = checkForHost(entry);
    if (!host) return bad(K.forHosts, "entries must be bare host names (no scheme, port, path or IP literal)");
    if (!forHosts.includes(host)) forHosts.push(host);
  }
  let scheme: "https" | "http" = "https";
  if (raw.scheme !== undefined) {
    if (raw.scheme !== "https" && raw.scheme !== "http") return bad(K.scheme, 'must be "https" or "http"');
    scheme = raw.scheme;
  }
  let port: number | undefined;
  if (raw.port !== undefined) {
    if (typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
      return bad(K.port, "must be an integer 1-65535");
    }
    port = raw.port === (scheme === "https" ? 443 : 80) ? undefined : raw.port;
  }
  return { suffix: suffix.suffix, forHosts, scheme, ...(port !== undefined ? { port } : {}) };
}

/** Shape + syntax validation. Pure; never throws. */
export function parsePreviewOrigins(raw: unknown): ParsedPreviewOrigins {
  const issues: PreviewOriginsIssue[] = [];
  const value: PreviewOriginsConfig = { enabled: true };
  if (raw === undefined) return { value, issues };
  if (!isRecord(raw)) {
    issues.push({ keys: [K.root], message: `${K.root} must be an object; ignored (defaults apply)` });
    return { value, issues };
  }
  if ("enabled" in raw && raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") value.enabled = raw.enabled;
    else {
      // The rollback switch: a quoted "false" must not silently stay on (Q17).
      value.enabled = false;
      issues.push({
        keys: [K.enabled],
        message: `${K.enabled} is not a boolean; treating as false (legacy preview paths only)`,
      });
    }
  }
  if (raw.wildcard !== undefined) {
    const w = parseWildcard(raw.wildcard, issues);
    if (w) value.wildcard = w;
  }
  if (raw.portPool !== undefined) {
    if (typeof raw.portPool !== "string") {
      issues.push({ keys: [K.portPool], message: `${K.portPool} must be a string "a-b"; tier 3 (port pool) disabled` });
    } else {
      const p = parsePortPool(raw.portPool);
      if (p.ok) value.portPool = raw.portPool;
      else issues.push({ keys: [K.portPool], message: `${K.portPool} ${p.reason}; tier 3 (port pool) disabled` });
    }
  }
  if (raw.ipDnsSuffix !== undefined) {
    if (typeof raw.ipDnsSuffix !== "string") {
      issues.push({ keys: [K.ipDnsSuffix], message: `${K.ipDnsSuffix} must be a string; tier 4 (ip-dns) disabled` });
    } else {
      const s = checkSuffix(raw.ipDnsSuffix);
      if (s.ok) value.ipDnsSuffix = s.suffix;
      else issues.push({ keys: [K.ipDnsSuffix], message: `${K.ipDnsSuffix} ${s.reason}; tier 4 (ip-dns) disabled` });
    }
  }
  if (value.wildcard && value.ipDnsSuffix && value.wildcard.suffix === value.ipDnsSuffix) {
    delete value.wildcard;
    delete value.ipDnsSuffix;
    issues.push({
      keys: [K.suffix, K.ipDnsSuffix],
      message: `${K.suffix} equals ${K.ipDnsSuffix}; tiers 2 and 4 disabled`,
    });
  }
  return { value, issues };
}

/** Server state the overlap checks need. Every list is read live by the caller. */
export interface PreviewOriginsContext {
  /** Dashboard port. */
  port: number;
  /** Pi gateway port. */
  piPort: number;
  /** TLS listener port, only when that listener is configured. */
  tlsPort?: number;
  /** Model-proxy second port, only when configured. */
  modelProxyPort?: number;
  allowedHosts: string[];
  publicBaseUrls: string[];
  corsOrigins: string[];
  /** Currently connected live-tunnel origins. */
  tunnelOrigins?: string[];
  /** Exact names the TLS listener holds a certificate for. */
  tlsNames?: string[];
  /** `classifyAdmittedHostname` bound to the live admission options (injected: server-only). */
  classifyAdmittedHostname?: (hostname: string) => string | null;
}

export interface ResolvedPreviewOrigins {
  enabled: boolean;
  wildcard?: PreviewWildcardConfig;
  portPool?: string;
  pool?: { from: number; to: number };
  ipDnsSuffix?: string;
  /**
   * Available tiers, ascending. Empty when `enabled` is false (legacy path only); the validated
   * `wildcard` / `pool` / `ipDnsSuffix` stay populated then, because they still define what is preview-shaped.
   */
  tiers: number[];
  /** Overlap issues found here (parse issues are reported by {@link parsePreviewOrigins}). */
  issues: PreviewOriginsIssue[];
}

function hostOf(entry: string): string | undefined {
  const trimmed = entry.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** `host` is `<26-base32>.<suffix>` — what a minted preview origin looks like. */
function isLabelShapedUnder(host: string, suffix: string): boolean {
  const h = normalizePreviewHost(host);
  const tail = `.${suffix}`;
  if (!h.endsWith(tail)) return false;
  return LABEL_SHAPE.test(h.slice(0, -tail.length));
}

/** First configured host that the suffix would make preview-shaped, with its source key. */
function findOverlap(
  suffix: string,
  extra: [string, string[]][],
): { source: string; host: string } | undefined {
  for (const [source, entries] of extra) {
    for (const entry of entries) {
      const host = hostOf(entry);
      if (host && isLabelShapedUnder(host, suffix)) return { source, host };
    }
  }
  return undefined;
}

/** Overlap validation against live server state. Pure; never throws. */
export function resolvePreviewOrigins(config: PreviewOriginsConfig, ctx: PreviewOriginsContext): ResolvedPreviewOrigins {
  const issues: PreviewOriginsIssue[] = [];

  const overlapSources = (wildcardForHosts: string[]): [string, string[]][] => [
    ["allowedHosts", ctx.allowedHosts],
    ["publicBaseUrls", ctx.publicBaseUrls],
    ["cors.allowedOrigins", ctx.corsOrigins],
    ["live tunnel origins", ctx.tunnelOrigins ?? []],
    ["TLS listener names", ctx.tlsNames ?? []],
    ...(wildcardForHosts.length ? ([[K.forHosts, wildcardForHosts]] as [string, string[]][]) : []),
  ];

  const checkSuffixTier = (
    key: string,
    suffix: string,
    tier: string,
    probe: string,
    forHosts: string[],
  ): boolean => {
    const overlap = findOverlap(suffix, overlapSources(forHosts));
    if (overlap) {
      issues.push({
        keys: [key],
        message: `${key} "${suffix}" covers a preview-shaped host from ${overlap.source}; ${tier} disabled`,
      });
      return false;
    }
    const cls = ctx.classifyAdmittedHostname?.(probe);
    if (cls) {
      issues.push({
        keys: [key],
        message: `${key} "${suffix}" is already admitted as a static host (${cls}); ${tier} disabled`,
      });
      return false;
    }
    return true;
  };

  const out: ResolvedPreviewOrigins = { enabled: config.enabled, tiers: [1], issues };

  if (config.wildcard) {
    const { suffix, forHosts } = config.wildcard;
    if (checkSuffixTier(K.suffix, suffix, "tier 2 (wildcard)", `${"a".repeat(PREVIEW_LABEL_LENGTH)}.${suffix}`, forHosts)) {
      out.wildcard = config.wildcard;
      out.tiers.push(2);
    }
  }

  if (config.portPool) {
    const p = parsePortPool(config.portPool);
    if (p.ok) {
      const reserved: [string, number | undefined][] = [
        ["port", ctx.port],
        ["piPort", ctx.piPort],
        ["tls.port", ctx.tlsPort],
        ["modelProxy.secondPort", ctx.modelProxyPort],
      ];
      const hit = reserved.find(([, n]) => n !== undefined && n >= p.range.from && n <= p.range.to);
      if (hit) {
        issues.push({
          keys: [hit[0]],
          message: `${K.portPool} ${config.portPool} contains the ${hit[0]} (${hit[1]}); tier 3 (port pool) disabled`,
        });
      } else {
        out.portPool = config.portPool;
        out.pool = p.range;
        out.tiers.push(3);
      }
    }
  }

  if (config.ipDnsSuffix) {
    const suffix = config.ipDnsSuffix;
    if (checkSuffixTier(K.ipDnsSuffix, suffix, "tier 4 (ip-dns)", `${"a".repeat(PREVIEW_LABEL_LENGTH)}.1-2-3-4.${suffix}`, [])) {
      out.ipDnsSuffix = suffix;
      out.tiers.push(4);
    }
  }

  out.tiers.push(5);
  out.tiers.sort((a, b) => a - b);
  // `enabled:false` = legacy path only, but a valid configured suffix/pool stays PREVIEW-SHAPED so
  // dispatch never routes such a host to the dashboard app (D3, Q11): keep the validated fields.
  if (!config.enabled) out.tiers = [];
  return out;
}

/** Boot line fragment, e.g. `1, 3(8100-8199), 5`. */
export function formatTierSet(r: Pick<ResolvedPreviewOrigins, "tiers" | "portPool">): string {
  return r.tiers.map((t) => (t === 3 && r.portPool ? `3(${r.portPool})` : String(t))).join(", ");
}

function signature(r: ResolvedPreviewOrigins): string {
  return JSON.stringify([r.enabled, r.tiers, r.wildcard ?? null, r.portPool ?? null, r.ipDnsSuffix ?? null, r.issues.map((i) => i.message)]);
}

/** True when the validation result or the resolved tier set differs (Q20: log only then). */
export function previewOriginsConfigChanged(prev: ResolvedPreviewOrigins | undefined, next: ResolvedPreviewOrigins): boolean {
  return !prev || signature(prev) !== signature(next);
}
