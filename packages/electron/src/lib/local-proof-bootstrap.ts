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

const LOCAL_TOKEN_HEADER = "x-pi-local-token";

/** The host-only local token, or null when absent/unreadable. */
function readLocalToken(): string | null {
  try {
    const t = readFileSync(path.join(getDashboardConfigDir(), "local", "token"), "utf-8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/** `X-Pi-Local-Token` header bag for main-process calls to our own server. */
export function localTokenHeaders(token: string | null = readLocalToken()): Record<string, string> {
  return token ? { [LOCAL_TOKEN_HEADER]: token } : {};
}

/** Mint a one-time code and return the bootstrap URL, or null on any failure. */
export async function mintLocalProofUrl(
  baseUrl: string,
  deps: { fetchImpl?: typeof fetch; token?: string | null } = {},
): Promise<string | null> {
  const token = deps.token === undefined ? readLocalToken() : deps.token;
  if (!token) return null;
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${baseUrl}/api/local-proof`, {
      method: "POST",
      headers: localTokenHeaders(token),
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
  win: { loadURL: (url: string) => Promise<void> | void },
  serverUrl: string,
  deps: { fetchImpl?: typeof fetch; token?: string | null } = {},
): Promise<boolean> {
  const proofUrl = await mintLocalProofUrl(serverUrl, deps);
  await win.loadURL(proofUrl ?? serverUrl);
  return proofUrl !== null;
}
