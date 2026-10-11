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
  deps: { fetchImpl?: typeof fetch; token?: string | null; host?: string } = {},
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
    return typeof code === "string" && code ? `${baseUrl}/auth/local-proof?code=${encodeURIComponent(code)}` : null;
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
