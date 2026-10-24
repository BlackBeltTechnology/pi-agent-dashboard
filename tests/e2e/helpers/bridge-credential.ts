/**
 * A gateway credential for specs that dial the bridge port directly.
 *
 * These specs run on the HOST and reach the container through a published
 * port, so the gateway sees the docker bridge address — not loopback. Since
 * bridge authentication became mandatory on the TCP listener, such a peer is
 * "remote" and must present a single-use, bridge-scoped ticket; without one
 * the upgrade is refused with 401 and the spec fails with a bare socket error.
 *
 * This drives the REAL pairing flow rather than installing a test backdoor:
 * redeem a pairing code, approve it, collect the durable device bearer, then
 * exchange it for a ticket. A spec therefore exercises the same path an
 * external pi session takes.
 *
 * See change: add-pi-gateway-transport-identity (D10b).
 */

import { execFileSync } from "node:child_process";
import { harnessProject } from "../lifecycle.js";

/**
 * The harness's local-IPC operator token, read from INSIDE the container.
 *
 * Specs run on the HOST and reach the container through a PUBLISHED port, so an
 * operator-guarded route (`/api/pair/approve`, `POST /api/paired-devices`) sees
 * the docker bridge address — not loopback — and refuses with 401 "operator
 * credential required". `X-Pi-Local-Token` is the designed credential for a
 * same-host process caller (server.ts `ensureLocalToken()` → 0600
 * `~/.pi/dashboard/local/token`), so the spec presents the REAL token rather
 * than a test backdoor.
 *
 * NOT cached: `pi-state` is a RAM-backed tmpfs, so every container start (and
 * every `/api/restart`, which respawns PID 1) regenerates the token. A
 * module-scope cache outlives that restart and serves a stale value — a
 * deterministic 401 with `workers: 1`. The extra `docker exec` is ~100ms.
 *
 * See change: stabilize-browser-e2e.
 */
function operatorToken(): string | undefined {
  try {
    const id = execFileSync(
      "docker",
      // Service filter too: a TEST_EXTRA_COMPOSE overlay adds sibling containers to the project.
      ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`, "--filter", "label=com.docker.compose.service=pi-dashboard"],
      { encoding: "utf8", timeout: 30_000 },
    )
      .trim()
      .split("\n")[0];
    if (!id) return undefined;
    const token = execFileSync(
      "docker",
      ["exec", id, "cat", "/home/pi/.pi/dashboard/local/token"],
      { encoding: "utf8", timeout: 30_000 },
    ).trim();
    if (!token) return undefined;
    return token;
  } catch (error) {
    // Degrade to an unauthenticated call — the route then fails with the REAL
    // 401 — but SAY why: a silent swallow reads as an auth bug, not infra.
    console.warn(`[e2e] could not read the harness operator token: ${String(error)}`);
    return undefined;
  }
}

/** Operator credential header for a guarded route (empty when unavailable). */
export function operatorHeaders(): Record<string, string> {
  const token = operatorToken();
  return token ? { "x-pi-local-token": token } : {};
}

async function postJson(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Options for a pairing that is not the default keyring-style (non-expiring) one. */
export interface PairOptions {
  /** Declare the bearer will be kept in browser storage (a 7 d expiring, rotating row). */
  holder?: "browser";
  /** Registry label (default `e2e-bridge`); a unique label lets a spec find its own row. */
  label?: string;
}

/** Pair once; the bearer plus, for a `holder:"browser"` pairing, its `expiresAt` (epoch ms). */
async function pairDevice(
  dashboardBase: string,
  opts: PairOptions = {},
): Promise<{ token: string; expiresAt?: number }> {
  const payload = await (await fetch(`${dashboardBase}/api/pair/payload`)).json();
  const code = payload?.data?.code;
  if (!code) throw new Error(`pairing payload had no code: ${JSON.stringify(payload)}`);
  const holder = opts.holder ? { holder: opts.holder } : {};

  const redeemed = await postJson(dashboardBase, "/api/pair/redeem", { code, ...holder });
  const { pendingId, confirmCode } = redeemed?.data ?? {};
  if (!pendingId) throw new Error(`redeem failed: ${JSON.stringify(redeemed)}`);

  const approved = await postJson(
    dashboardBase,
    "/api/pair/approve",
    {
      code,
      confirmCode,
      label: opts.label ?? "e2e-bridge",
    },
    operatorHeaders(),
  );
  if (!approved?.success) throw new Error(`approve failed: ${JSON.stringify(approved)}`);

  const polled = await postJson(dashboardBase, "/api/pair/poll", { pendingId, ...holder });
  const token = polled?.data?.token;
  if (!token) throw new Error(`poll returned no token: ${JSON.stringify(polled)}`);
  const expiresAt = polled?.data?.expiresAt;
  return { token, ...(typeof expiresAt === "number" ? { expiresAt } : {}) };
}

/** Pair once and return the durable device bearer. */
export async function pairDeviceBearer(dashboardBase: string): Promise<string> {
  return (await pairDevice(dashboardBase)).token;
}

/**
 * Pair once declaring `holder:"browser"` and return the 7 d bearer with its `expiresAt`
 * (epoch ms) — what a cross-origin browser client keeps in its per-origin slot.
 * See change: harden-auth-credentials (D5).
 */
export async function pairBrowserBearer(
  dashboardBase: string,
  opts: Omit<PairOptions, "holder"> = {},
): Promise<{ token: string; expiresAt: number }> {
  const paired = await pairDevice(dashboardBase, { ...opts, holder: "browser" });
  if (typeof paired.expiresAt !== "number") throw new Error(`browser pairing returned no expiresAt for ${dashboardBase}`);
  return { token: paired.token, expiresAt: paired.expiresAt };
}

/**
 * A gateway URL carrying a FRESH ticket. Tickets are single-use with a short
 * TTL, so call this per connection — reusing one is a 401, not a flake.
 */
export async function gatewayUrlWithTicket(
  dashboardBase: string,
  gatewayPort: number,
  bearer: string,
): Promise<string> {
  const res = await fetch(`${dashboardBase}/api/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ scope: "bridge" }),
  });
  const body = await res.json();
  const ticket = body?.data?.ticket;
  if (!ticket) throw new Error(`ticket mint failed (${res.status}): ${JSON.stringify(body)}`);
  return `ws://127.0.0.1:${gatewayPort}?ticket=${encodeURIComponent(ticket)}`;
}
