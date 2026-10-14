/**
 * Main-process remote-dashboard reachability probe.
 *
 * Extracted from `remote-connect-window.ts` so `main.ts` can back a
 * `dashboard:probe-server` IPC handler WITHOUT importing the BrowserWindow /
 * IPC-registration code in that module. This is a Node `fetch` — it sends NO
 * browser `Origin` header and is therefore not subject to the remote's CORS
 * policy (unlike a renderer `fetch` from the `file://` loading page, whose
 * `Origin: null` a remote deliberately refuses). Same engine already behind
 * "Test Connection".
 *
 * SSRF guard (change: harden-electron-renderer-boundary, B10): targets that
 * resolve to link-local (169.254.0.0/16 — cloud metadata — and fe80::/10) or
 * unspecified (0.0.0.0/8, ::) addresses are refused before any fetch.
 * Loopback and RFC1918 are intentionally ALLOWED: LAN / localhost / Docker
 * dashboards are the primary remote-connect use case. The renderer-reachability
 * half of the SSRF is closed by sender-frame gating (`ipc-trust.ts`).
 * Residual (accepted): DNS rebinding between the check and fetch's own
 * resolution is not pinned, and redirects are still followed (http→https
 * fronting is common) without re-validating the hop. Only the trusted wizard /
 * loading page can reach this, and only `ok`/`version` is returned.
 *
 * See change: fix-remote-connect-cors-gates.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface RemoteProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

/** Normalize a user-entered URL: trim, default http://, strip trailing slash. */
export function normalizeRemoteUrl(input: unknown): string | null {
  const v = typeof input === "string" ? input.trim() : "";
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  return withScheme.replace(/\/+$/, "");
}

/** Resolve a hostname to all its IP addresses (injectable for tests). */
export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => a.address);

/** Parse an IPv6 literal into 8 16-bit groups (null when malformed). */
function parseIPv6(addr: string): number[] | null {
  const noZone = addr.split("%")[0];
  let head = noZone;
  let tailV4: number[] = [];
  const lastColon = head.lastIndexOf(":");
  if (head.slice(lastColon + 1).includes(".")) {
    const v4 = head.slice(lastColon + 1).split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tailV4 = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    head = `${head.slice(0, lastColon + 1)}0:0`;
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  if (tailV4.length) { groups[6] = tailV4[0]; groups[7] = tailV4[1]; }
  return groups;
}

/** True for link-local / unspecified addresses (v4, v6, and v4-mapped v6). */
export function isBlockedProbeAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || (a === 169 && b === 254);
  }
  if (v === 6) {
    const g = parseIPv6(address);
    if (!g) return true; // unparseable → fail closed
    if (g.every((x) => x === 0)) return true; // ::
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    const isV4Mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    if (isV4Mapped) return isBlockedProbeAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    return false;
  }
  return true; // not an IP at all → fail closed
}

/** Probe `${url}/api/health` with a short timeout. Node fetch — no Origin header. */
export async function probeRemote(
  url: string,
  resolveHost: HostResolver = defaultResolver,
): Promise<RemoteProbeResult> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolveHost(host);
  } catch {
    return { ok: false, reason: "Connection refused" };
  }
  if (addresses.length === 0 || addresses.some(isBlockedProbeAddress)) {
    return { ok: false, reason: "Target not allowed" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let version: string | undefined;
    try {
      const body = (await res.json()) as { version?: string };
      if (typeof body?.version === "string") version = body.version;
    } catch {
      /* health may return non-JSON */
    }
    return { ok: true, version };
  } catch (err) {
    const reason = (err as Error)?.name === "AbortError" ? "Timed out" : "Connection refused";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
