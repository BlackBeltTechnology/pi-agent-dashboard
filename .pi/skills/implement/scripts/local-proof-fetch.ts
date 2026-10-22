/**
 * `fetch` to the LOCAL dashboard that proves local possession.
 *
 * Under the strict `requireLocalProof` default a bare `fetch('http://localhost:<port>/api/restart')`
 * is refused (403 `local_proof_required`). This dials the loopback ADDRESS LITERAL (a proof binds a
 * literal, never `localhost`) and sends a freshly minted `X-Pi-Local-Proof` for that exact request.
 * Read-only probes of observe routes do not need it; anything else does.
 *
 * Node built-ins + the shared proof primitive only. No token ⇒ no proof header (the server answers
 * 403, which is the honest outcome on a host where the dashboard never ran).
 *
 * See change: close-container-loopback-impersonation (D5).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { httpProofHeaders, localDialHost } from '@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js';

function localToken(): string | null {
  try {
    return readFileSync(join(homedir(), '.pi', 'dashboard', 'local', 'token'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** `fetch(http://127.0.0.1:<port><path>)` with a proof for this method + path. */
export function localFetch(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `http://127.0.0.1:${port}${path}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const token = localToken();
  const headers = new Headers(init.headers);
  if (token) {
    for (const [k, v] of Object.entries(httpProofHeaders(token, url, method))) headers.set(k, v);
  }
  return fetch(url, { ...init, headers });
}

/** A `BusClient` `proofHeaders` provider: a proof for this method + URL, or `{}` with no local token. */
export function localProofHeaders(method: string, url: string): Record<string, string> {
  const token = localToken();
  if (!token) return {};
  try {
    return httpProofHeaders(token, url, method);
  } catch {
    return {};
  }
}

/** The literal to dial for a configured host (`localhost` → `127.0.0.1`): a proof binds a literal. */
export function dialHost(configured: string | undefined = process.env.DASHBOARD_HOST): string {
  return localDialHost(configured);
}
