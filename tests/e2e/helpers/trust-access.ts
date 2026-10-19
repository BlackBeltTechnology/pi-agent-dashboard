/**
 * Harness trust access — the ONE module that reads and writes the trust-bearing
 * keys of the shared harness (`/api/config`) and owns the on-disk state the
 * fixtures share across Playwright workers.
 *
 * Why a module and not per-spec helpers: a narrowed harness refuses the
 * credential-free bus client but still admits an authenticated caller
 * (`localhost-guard.ts`), so every read/write here carries the operator-session
 * cookie AND the harness's local-IPC token (`X-Pi-Local-Token`, read from the
 * container). Both are needed: with `auth.bypassUrls: ["/"]` still seeded the
 * auth hook returns before the cookie branch, so after a `trustedNetworks`-only
 * narrowing (lan-knock) the cookie alone is refused `network_not_allowed` and
 * the restore would be impossible; the local token is admitted regardless. The trust
 * write lint (`scripts/check-e2e-fixture-import.mjs`) allowlists this file,
 * `fixtures.ts` and `global-setup.ts` — specs reach it only through
 * `narrowTrust`.
 *
 * Playwright discards a worker after a failed test, so module state does not
 * survive the failure that matters; the boot baseline and the refusal verdict
 * are therefore files under `test-results/`.
 *
 * See change: triage-browser-e2e-offbox-poison (design D2, D3).
 */

import fs from "node:fs";
import path from "node:path";
import { COOKIE_NAME, signToken } from "../../../packages/server/src/auth/auth.js";
import { BASE_URL, REPO_ROOT } from "../lifecycle.js";
import { recordBaseline, recordCredentialFreeAdmission, type TrustBaselineFile } from "../reap-core.js";
import { operatorHeaders as localTokenHeaders } from "./bridge-credential.js";

/** The KNOWN e2e secret seeded by `docker/test-entrypoint.sh` (PI_E2E_OAUTH=1). */
const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const E2E_SESSION_USER = {
  sub: "e2e@example.com",
  name: "e2e operator",
  username: "e2e",
  provider: "github",
};

const RESULTS_DIR = path.join(REPO_ROOT, "test-results");
/** Written by globalSetup: the harness's boot trust posture + which read paths exist. */
const TRUST_BASELINE_PATH = path.join(RESULTS_DIR, ".trust-baseline.json");
/** Written by the fixture on a policy refusal; read by every later worker (sticky across worker restarts). */
const REFUSAL_LATCH_PATH = path.join(RESULTS_DIR, ".harness-refused.json");

/** Cookie header authenticating as the e2e operator. */
export function operatorHeaders(): Record<string, string> {
  return { cookie: `${COOKIE_NAME}=${signToken(E2E_SESSION_USER, E2E_AUTH_SECRET)}` };
}

/**
 * The harness's local-IPC token. `pi-state` is RAM-backed, so a container start or
 * `/api/restart` regenerates it: cache it per worker (a `docker exec` per call
 * would tax every test) and re-read once when a credentialed call is refused.
 */
let cachedLocalToken: Record<string, string> | undefined;
function credentialHeaders(refresh = false): Record<string, string> {
  if (refresh || cachedLocalToken === undefined) cachedLocalToken = localTokenHeaders();
  return { ...operatorHeaders(), ...cachedLocalToken };
}

/** `fetch` with the operator credentials, retried once with a fresh local token when refused. */
async function credentialedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const attempt = (refresh: boolean) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...credentialHeaders(refresh) },
      signal: AbortSignal.timeout(10_000),
    });
  const first = await attempt(false);
  return first.status === 401 || first.status === 403 ? await attempt(true) : first;
}

export interface ConfigRead {
  status: number;
  error?: string;
  data?: Record<string, unknown> & { auth?: Record<string, unknown> };
}

/** `GET /api/config` — with the operator cookie when `credential`, else credential-free. */
export async function readConfig(credential: boolean, baseUrl: string = BASE_URL): Promise<ConfigRead> {
  const res = credential
    ? await credentialedFetch(`${baseUrl}/api/config`)
    : await fetch(`${baseUrl}/api/config`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: res.status, error: body.error };
  }
  const body = (await res.json()) as { data?: ConfigRead["data"] };
  return { status: res.status, data: body.data };
}

/** `PUT /api/config` with the operator cookie. Returns the HTTP status. */
export async function writeConfig(payload: Record<string, unknown>, baseUrl: string = BASE_URL): Promise<number> {
  const res = await credentialedFetch(`${baseUrl}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.status;
}

/** One credential-free ticket mint — the exact request the reap's bus client makes. */
async function mintCredentialFree(baseUrl: string): Promise<{ status: number }> {
  const res = await fetch(`${baseUrl}/api/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "browser" }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status };
}

/**
 * globalSetup — measure the freshly booted harness once and persist the result.
 * Transport failures on the admission mint are retried and then abort setup
 * (decision E3); they are never recorded as "not admitted".
 */
export async function recordTrustBaseline(baseUrl: string, budgetMs = 60_000): Promise<TrustBaselineFile> {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.rmSync(REFUSAL_LATCH_PATH, { force: true });

  const credentialFreeAdmitted = await recordCredentialFreeAdmission({
    mint: () => mintCredentialFree(baseUrl),
    budgetMs,
  });

  // `credential` = an operator cookie can exist at all, i.e. `auth` is configured.
  // A trusted-network harness answers the cookie read 200 even when auth is off,
  // so the status alone proves nothing: look for the seeded providers.
  const withCookie = await readConfig(true, baseUrl).catch(() => ({ status: 0 }) as ConfigRead);
  const authConfigured =
    withCookie.status === 200 && Object.keys((withCookie.data?.auth?.providers as object | undefined) ?? {}).length > 0;
  let config: ConfigRead["data"] | null = null;
  if (authConfigured) {
    config = withCookie.data ?? null;
  } else if (credentialFreeAdmitted) {
    const open = await readConfig(false, baseUrl).catch(() => ({ status: 0 }) as ConfigRead);
    config = open.status === 200 ? (open.data ?? null) : null;
  }

  const file = recordBaseline({ credential: authConfigured, credentialFreeAdmitted, config });
  fs.writeFileSync(TRUST_BASELINE_PATH, `${JSON.stringify(file, null, 2)}\n`);
  return file;
}

/** The recorded baseline, or `undefined` when globalSetup did not run (e.g. a lone `--list`). */
export function readBaselineFile(): TrustBaselineFile | undefined {
  try {
    return JSON.parse(fs.readFileSync(TRUST_BASELINE_PATH, "utf8")) as TrustBaselineFile;
  } catch {
    return undefined;
  }
}

/** The persisted refusal verdict (sticky across worker restarts), if any. */
export function readRefusalLatch(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(REFUSAL_LATCH_PATH, "utf8")) as { message: string }).message;
  } catch {
    return undefined;
  }
}

export function writeRefusalLatch(message: string): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REFUSAL_LATCH_PATH, JSON.stringify({ message }));
}
