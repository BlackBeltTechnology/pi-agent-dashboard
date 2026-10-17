/**
 * Local-proof bootstrap for the Electron window.
 *
 * The desktop app owns the dashboard on this host, so it can read the host-only
 * local token and exchange it for a one-time code. Loading
 * `/auth/local-proof?code=…` sets the httpOnly `pi_dash_local` cookie in the
 * window's session, which (a) satisfies `requireLocalProof` and (b) is required
 * to approve device pairings (the approval route honors no bare loopback).
 * Always done, strict mode or not. Failure degrades to the plain URL.
 * See change: harden-trust-and-credential-boundaries (D2/D6).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  httpProofHeaders,
  isLoopbackLiteral,
  localDialHost,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { normalizeRemoteUrl } from "./remote-probe.js";

/** The host-only local token, or null when absent/unreadable. */
function readLocalToken(): string | null {
  try {
    const t = readFileSync(path.join(getDashboardConfigDir(), "local", "token"), "utf-8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/**
 * The base URL main-process calls to our own server dial: the address LITERAL the
 * server's bind maps to, never `localhost` — a local credential proof is bound to
 * the literal address + port actually reached. The window keeps loading
 * `http://localhost:<port>`; only API calls dial this.
 * See change: loopback-credential-proof (D10).
 */
export function localApiBase(config: { host?: string; port: number }): string {
  return `http://${localDialHost(config.host)}:${config.port}`;
}

/**
 * `X-Pi-Local-Proof` header bag for ONE main-process request to our own server
 * (`url` must be an address-literal URL from `localApiBase`). A proof is
 * single-use: mint per request. The raw token never leaves this process.
 */
export function localProofHeaders(
  method: string,
  url: string,
  token: string | null = readLocalToken(),
): Record<string, string> {
  return token ? httpProofHeaders(token, url, method) : {};
}

/** The literal-dial form of a window URL, or null when it does not name THIS host. */
function localDialUrl(baseUrl: string, host?: string): string | null {
  try {
    const u = new URL(baseUrl);
    const hostname = u.hostname.replace(/^\[|\]$/g, "");
    const literal = hostname.toLowerCase() === "localhost" ? localDialHost(host) : isLoopbackLiteral(hostname) ? u.hostname : null;
    return literal ? `${u.protocol}//${literal}${u.port ? `:${u.port}` : ""}` : null;
  } catch {
    return null;
  }
}

/** Mint a one-time code and return the bootstrap URL, or null on any failure. */
export async function mintLocalProofUrl(
  baseUrl: string,
  deps: { fetchImpl?: typeof fetch; token?: string | null; host?: string; next?: string } = {},
): Promise<string | null> {
  const token = deps.token === undefined ? readLocalToken() : deps.token;
  if (!token) return null;
  // Never present a local credential to a host that is not this one.
  const dial = localDialUrl(baseUrl, deps.host);
  if (!dial) return null;
  try {
    const proofUrl = `${dial}/api/local-proof`;
    const res = await (deps.fetchImpl ?? fetch)(proofUrl, {
      method: "POST",
      headers: localProofHeaders("POST", proofUrl, token),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { code?: unknown } };
    const code = body.data?.code;
    if (typeof code !== "string" || !code) return null;
    const next = deps.next === undefined ? "" : `&next=${encodeURIComponent(deps.next)}`;
    return `${baseUrl}/auth/local-proof?code=${encodeURIComponent(code)}${next}`;
  } catch {
    return null;
  }
}

/**
 * Load the dashboard into `win`, bootstrapping local proof first. Resolves true
 * when the bootstrap URL was loaded, false when it fell back to the plain URL.
 */
export async function loadWithLocalProof(
  win: { loadURL: (url: string) => unknown },
  serverUrl: string,
  deps: { fetchImpl?: typeof fetch; token?: string | null; host?: string } = {},
): Promise<boolean> {
  const proofUrl = await mintLocalProofUrl(serverUrl, deps);
  await win.loadURL(proofUrl ?? serverUrl);
  return proofUrl !== null;
}

/**
 * Electron-side twin of the server's `sanitizeReturnUrl` (`auth-plugin.ts`): the
 * only shape `GET /auth/local-proof?next=` will honour — a same-origin path with
 * no control characters, not `//…` or `/\…`. Anything else → `/`. Duplicated
 * (not imported) because the electron bundle never depends on packages/server;
 * both are tested against the same vectors.
 * See change: fix-pairing-approval-credential (D4/D6).
 */
export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  try {
    if (new URL(raw, "http://x.invalid").origin !== "http://x.invalid") return "/";
  } catch {
    return "/";
  }
  return raw;
}

/** Subset of the minimal config `navigateToServer` needs (main passes `loadMinimalConfig()`). */
interface NavigateConfig {
  port: number;
  host?: string;
  knownServers: ReadonlyArray<{ host: string; port: number }>;
}

export interface NavigateToServerDeps {
  config: NavigateConfig;
  /** The `serverUrl` the main window was created for (the `remoteUrl` in remote mode). */
  windowServerUrl?: string;
  fetchImpl?: typeof fetch;
  token?: string | null;
}

/** Acknowledgement only — never a URL, a code, or any credential material. */
export interface NavigateResult {
  navigated: boolean;
  reason?: "target-not-allowed" | "scheme-not-allowed" | "invalid-target" | "load-failed" | "no-window";
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origins a renderer may ask the main window to navigate to. */
function allowedOrigins(deps: NavigateToServerDeps): Set<string> {
  const out = new Set<string>();
  for (const h of LOOPBACK_HOSTS) {
    const o = originOf(`http://${h}:${deps.config.port}`);
    if (o) out.add(o);
  }
  if (deps.windowServerUrl) {
    const n = normalizeRemoteUrl(deps.windowServerUrl);
    const o = n ? originOf(n) : null;
    if (o) out.add(o);
  }
  for (const s of deps.config.knownServers) {
    const host = s.host.includes(":") && !s.host.startsWith("[") ? `[${s.host}]` : s.host;
    const o = originOf(`http://${host}:${s.port}`);
    if (o) out.add(o);
  }
  return out;
}

/** `scheme:` that is not `http(s)` and not a `host:port` shorthand (`localhost:8000`). */
function hasForeignScheme(raw: string): boolean {
  if (/^https?:\/\//i.test(raw)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return !/^[^/?#:@]+:\d+(?:[/?#]|$)/.test(raw);
}

/**
 * Navigate the window to a dashboard target on behalf of a TRUSTED renderer
 * (sender gate lives in main). The navigation happens HERE via `win.loadURL`
 * and only an acknowledgement goes back, so the renderer never sees the
 * single-use code or a URL carrying it.
 *
 * Order: (0) target origin must be the configured local server, the window's
 * own serverUrl, or a known server — else refuse (no `openExternal`); (1)
 * `http:`/`https:` only; (2) host must be THIS host; (3) port pinned to the
 * CONFIGURED port, never the renderer-supplied one. Anything not minted for is
 * loaded unchanged; a failed mint degrades to the plain target.
 * See change: fix-pairing-approval-credential (D4).
 */
export async function navigateToServer(
  win: { loadURL: (url: string) => unknown },
  target: unknown,
  deps: NavigateToServerDeps,
): Promise<NavigateResult> {
  if (typeof target !== "string" || !target.trim()) return { navigated: false, reason: "invalid-target" };
  if (hasForeignScheme(target.trim())) return { navigated: false, reason: "scheme-not-allowed" };
  const normalized = normalizeRemoteUrl(target);
  let u: URL;
  try {
    u = new URL(normalized ?? "");
  } catch {
    // Unparseable (e.g. `http://localhost:8000.evil.com`) has no origin to allow.
    return { navigated: false, reason: "target-not-allowed" };
  }
  if (!allowedOrigins(deps).has(u.origin)) return { navigated: false, reason: "target-not-allowed" };
  if (u.protocol !== "http:" && u.protocol !== "https:") return { navigated: false, reason: "scheme-not-allowed" };

  let url = normalized as string;
  const effectivePort = u.port || (u.protocol === "https:" ? "443" : "80");
  // Mint only for THIS host on the configured port (http — the server speaks no TLS).
  if (u.protocol === "http:" && effectivePort === String(deps.config.port) && localDialUrl(u.origin, deps.config.host)) {
    const minted = await mintLocalProofUrl(u.origin, {
      fetchImpl: deps.fetchImpl,
      token: deps.token,
      host: deps.config.host,
      next: sanitizeNextPath(`${u.pathname}${u.search}`),
    });
    if (minted) url = minted;
  }
  try {
    await win.loadURL(url);
  } catch {
    return { navigated: false, reason: "load-failed" };
  }
  return { navigated: true };
}
