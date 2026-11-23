/**
 * Framing probe — the dashboard's first outbound request made on a user's click,
 * to an attacker-influenced host. Everything here is SSRF defence:
 *
 *   - `https:` port 443, no userinfo, WHATWG-normalised host, on EVERY hop;
 *   - refuses everything the dashboard trusts (`isUngrantableEgressOrigin`,
 *     `classifyCorsOrigin`, the own-origin set) — an internal name, a tunnel, the PWA shell;
 *   - `dns.lookup(all)`; every address must be a public unicast address, and the
 *     socket is PINNED to the first vetted one (a dedicated `https.Agent` with a
 *     custom `lookup`, no proxy environment) so DNS rebinding cannot swap it;
 *   - `HEAD` only, origin root first, no cookies / `Authorization`, headers only
 *     (64 KB cap), socket destroyed; redirects re-enter the full check, ≤ 3 requests;
 *   - one 5 s overall deadline.
 *
 * Returns a verdict only; never the response. See change: rich-chat-links (design D12).
 */
import dns from "node:dns";
import type http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  canonicalHttpsOrigin,
  isPublicUnicastAddress,
  isUngrantableEgressOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import { type CorsOriginOptions, classifyCorsOrigin } from "../auth/cors-origin.js";
import { computeFrameVerdict, type FrameVerdict } from "./frame-policy-verdict.js";

export type ProbeVerdict = FrameVerdict | "ineligible";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ProbeRequestFn = (options: https.RequestOptions, onResponse: (res: http.IncomingMessage) => void) => http.ClientRequest;

export interface ProbeDeps {
  /** Dashboard-own origins (tunnels, public base URLs, configured CORS origins). */
  ownOrigins: readonly string[];
  corsOpts: CorsOriginOptions;
  /** DNS seam (default `dns.promises.lookup(host, { all: true })`). */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Transport seam (default `https.request`). */
  request?: ProbeRequestFn;
  deadlineMs?: number;
}

export interface ProbeResult {
  verdict: ProbeVerdict;
  /** Requests actually sent. */
  hops: number;
}

export const PROBE_DEADLINE_MS = 5000;
/** Total requests, the first included: A → B → C is the last connect, a redirect out of C is refused. */
export const MAX_PROBE_REQUESTS = 3;
const MAX_HEADER_BYTES = 64 * 1024;
const USER_AGENT = "pi-dashboard-frame-probe/1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultLookup = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family,
  }));

interface FinalResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
}

/** The hostname with IPv6 brackets stripped. */
function bareHost(u: URL): string {
  return u.hostname.startsWith("[") ? u.hostname.slice(1, -1) : u.hostname;
}

/** Per-hop checks (a) and (b): returns the canonical origin, or null when ineligible. */
function vetTarget(url: URL, deps: ProbeDeps, dashboardOrigin: string): string | null {
  // `URL.port` is "" for the default 443, so any non-empty port is refused.
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const canon = canonicalHttpsOrigin(url.origin);
  if (!canon) return null;
  const own = [...deps.ownOrigins, dashboardOrigin];
  if (isUngrantableEgressOrigin(canon, own)) return null;
  if (classifyCorsOrigin(canon, deps.corsOpts).allowed) return null;
  return canon;
}

/** A `lookup` for `net.connect` that can only ever answer with the vetted address. */
function pinnedLookup(vetted: ResolvedAddress) {
  return (_host: string, options: unknown, cb: (...args: unknown[]) => void): void => {
    const callback = (typeof options === "function" ? options : cb) as (...args: unknown[]) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (all) callback(null, [{ address: vetted.address, family: vetted.family }]);
    else callback(null, vetted.address, vetted.family);
  };
}

/** HEAD one hop; resolves on the status line + headers, then tears the socket down. */
function head(
  url: URL,
  vetted: ResolvedAddress,
  request: ProbeRequestFn,
  signal: AbortSignal,
): Promise<FinalResponse> {
  return new Promise((resolve, reject) => {
    // A dedicated agent: never `https.globalAgent`, so a proxy env cannot re-resolve the target.
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1, lookup: pinnedLookup(vetted) as never });
    const finish = () => agent.destroy();
    const req = request(
      {
        method: "HEAD",
        host: bareHost(url),
        port: 443,
        path: `${url.pathname}${url.search}`,
        agent,
        signal,
        maxHeaderSize: MAX_HEADER_BYTES,
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
      },
      (res) => {
        const out = { status: res.statusCode ?? 0, headers: res.headers };
        res.destroy();
        req.destroy();
        finish();
        resolve(out);
      },
    );
    req.on("error", (err) => {
      finish();
      reject(err);
    });
    req.end();
  });
}

export async function probeFramePolicy(
  rawOrigin: string,
  dashboardOrigin: string,
  deps: ProbeDeps,
): Promise<ProbeResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const request: ProbeRequestFn = deps.request ?? ((o, cb) => https.request(o, cb));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.deadlineMs ?? PROBE_DEADLINE_MS);
  const aborted = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  });
  aborted.catch(() => {}); // never an unhandled rejection when the probe finishes first
  let hops = 0;
  try {
    let url: URL;
    try {
      url = new URL(rawOrigin);
    } catch {
      return { verdict: "ineligible", hops };
    }
    // Vet the raw input first (the rebuilt URL below no longer carries userinfo), then keep
    // the origin only: the user's path, query and fragment are never sent.
    if (!vetTarget(url, deps, dashboardOrigin)) return { verdict: "ineligible", hops };
    url = new URL(`${url.origin}/`);
    for (;;) {
      const canon = vetTarget(url, deps, dashboardOrigin);
      if (!canon) return { verdict: "ineligible", hops };
      const host = bareHost(url);
      let addresses: ResolvedAddress[];
      try {
        addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await Promise.race([lookup(host), aborted]);
      } catch {
        return { verdict: "ineligible", hops };
      }
      if (addresses.length === 0 || !addresses.every((a) => isPublicUnicastAddress(a.address))) {
        return { verdict: "ineligible", hops };
      }
      hops++;
      let res: FinalResponse;
      try {
        res = await Promise.race([head(url, addresses[0], request, ctl.signal), aborted]);
      } catch {
        return { verdict: "undetermined", hops }; // timeout or reset AFTER a vetted connect
      }
      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(res.status) && typeof location === "string" && location) {
        if (hops >= MAX_PROBE_REQUESTS) return { verdict: "ineligible", hops };
        try {
          url = new URL(location, url);
        } catch {
          return { verdict: "ineligible", hops };
        }
        continue;
      }
      return {
        verdict: computeFrameVerdict({
          status: res.status,
          headers: res.headers,
          targetOrigin: canon,
          dashboardOrigin,
        }),
        hops,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
