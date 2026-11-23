/**
 * Framing verdict — pure (no network). Decides whether a final HEAD response
 * lets the dashboard origin frame the page, following the browser's
 * precedence: any CSP `frame-ancestors` decides alone, otherwise
 * `X-Frame-Options`; only a final 2xx counts, anything else is `undetermined`.
 * The verdict is a UX gate, not a security boundary (the frame is opaque).
 *
 * See change: rich-chat-links (design D12.5).
 */

export type FrameVerdict = "allowed" | "refused" | "undetermined";

export interface FrameVerdictInput {
  status: number;
  /** Lower-case header names; a repeated header may be an array or a comma-joined string. */
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** Canonical origin of the document being framed (the final hop). */
  targetOrigin: string;
  /** Origin of the dashboard page that would frame it. */
  dashboardOrigin: string;
}

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21" };

function headerValues(v: string | readonly string[] | undefined): string[] {
  if (v === undefined) return [];
  return typeof v === "string" ? [v] : [...v];
}

function portOf(u: URL): string {
  return u.port || DEFAULT_PORTS[u.protocol] || "";
}

/** CSP3 scheme match: an `http:` source also covers `https:`; `ws:` covers `wss:`. */
function schemeMatches(sourceScheme: string, ancestorScheme: string): boolean {
  if (sourceScheme === ancestorScheme) return true;
  return (
    (sourceScheme === "http:" && ancestorScheme === "https:") || (sourceScheme === "ws:" && ancestorScheme === "wss:")
  );
}

/** `'self'`: the ancestor must be same-origin with the framed target (scheme-upgrade aware). */
function selfMatches(ancestor: URL, target: URL): boolean {
  return (
    schemeMatches(target.protocol, ancestor.protocol) &&
    ancestor.hostname === target.hostname &&
    portOf(ancestor) === portOf(target)
  );
}

/** Host part of a host-source: `*`, `*.suffix` or an exact hostname. */
function hostPartMatches(host: string, ancestor: URL): boolean {
  if (host === "*") return true; // any host
  if (host.startsWith("*.")) return ancestor.hostname.endsWith(host.slice(1));
  return ancestor.hostname === host;
}

/** host-source: [scheme "://"] host [":" port] [path] */
function hostSourceMatches(lower: string, ancestor: URL, target: URL): boolean {
  const m = lower.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^/:]+|[^/:*]+)(?::(\*|\d+))?(?:\/.*)?$/);
  if (!m) return false;
  const [, scheme, host, port] = m;
  const sourceScheme = scheme ? `${scheme}:` : target.protocol;
  if (!schemeMatches(sourceScheme, ancestor.protocol)) return false;
  if (!hostPartMatches(host, ancestor)) return false;
  if (port === "*") return true;
  return (port ?? DEFAULT_PORTS[ancestor.protocol] ?? "") === portOf(ancestor);
}

/** Does one `frame-ancestors` source expression match the ancestor? */
function sourceMatches(source: string, ancestor: URL, target: URL): boolean {
  const lower = source.toLowerCase();
  if (lower === "'none'") return false;
  if (lower === "'self'") return selfMatches(ancestor, target);
  if (lower.startsWith("'")) return false; // nonce/hash/unsafe-* keywords never match an ancestor
  if (lower === "*") return NETWORK_SCHEMES.has(ancestor.protocol);
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return schemeMatches(lower, ancestor.protocol);
  return hostSourceMatches(lower, ancestor, target);
}

/** Every policy carrying `frame-ancestors`; null when none does. Each must admit the ancestor. */
function frameAncestorsDecision(cspValues: string[], ancestor: URL, target: URL): boolean | null {
  let decided: boolean | null = null;
  for (const header of cspValues) {
    for (const policy of header.split(",")) {
      const directive = policy
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .find((tokens) => tokens[0]?.toLowerCase() === "frame-ancestors"); // first occurrence wins
      if (!directive) continue;
      const sources = directive.slice(1);
      const real = sources.filter((s) => s.toLowerCase() !== "'none'");
      const ok = real.length > 0 && real.some((s) => sourceMatches(s, ancestor, target));
      decided = (decided ?? true) && ok;
    }
  }
  return decided;
}

/** `X-Frame-Options`: true = refused. A single unparseable value is ignored. */
function xfoRefuses(values: string[]): boolean {
  const tokens = values
    .flatMap((v) => v.split(","))
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => t === "DENY" || t === "SAMEORIGIN" || t.startsWith("ALLOW-FROM"))) return true;
  return new Set(tokens).size > 1; // conflicting, unparseable values
}

export function computeFrameVerdict(input: FrameVerdictInput): FrameVerdict {
  if (input.status < 200 || input.status > 299) return "undetermined";
  let target: URL;
  let ancestor: URL;
  try {
    target = new URL(input.targetOrigin);
    ancestor = new URL(input.dashboardOrigin);
  } catch {
    return "undetermined";
  }
  const csp = frameAncestorsDecision(headerValues(input.headers["content-security-policy"]), ancestor, target);
  if (csp !== null) return csp ? "allowed" : "refused";
  return xfoRefuses(headerValues(input.headers["x-frame-options"])) ? "refused" : "allowed";
}
