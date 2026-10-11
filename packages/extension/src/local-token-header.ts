/**
 * The bridge's local credential for a loopback TCP gateway (D6, task 5.3) — a
 * PROOF of possession, never the token itself.
 *
 * Windows has no unix-socket transport, so its local bridge dials
 * `127.0.0.1:<piPort>` — and an address is not a credential. The dashboard
 * writes `~/.pi/dashboard/local/token` readable only by the same OS user; a
 * bridge that can read it proves same-user, which is exactly the entitlement
 * the socket's `0600` mode proves on POSIX. The bridge proves it by sending an
 * HMAC bound to the address literal + port it actually reached, so a process
 * that merely holds the dialled port harvests nothing it can reuse.
 *
 * For a loopback TCP dial the plan first opens the TCP connection itself
 * (`net.connect({host, port})` — Node's own resolution, exactly what `ws` would
 * do) and binds the proof to that socket's remote address, then hands the
 * connected socket to `ws` via `createConnection`. A bridge MARKED by its
 * spawner (`PI_DASHBOARD_REQUIRE_SERVER_PROOF`) additionally verifies the
 * server counter-proof on the upgrade response, before `open`.
 *
 * Scope is deliberately narrow: only a loopback TCP dial gets a plan. Over a
 * unix socket it is redundant, and to a remote endpoint it would be a leak — the
 * remote path authenticates with a ticket and a pinned identity instead.
 *
 * See change: add-pi-gateway-transport-identity (D6); loopback-credential-proof (D1, D6, D7).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  isLoopbackLiteral,
  LOCAL_PROOF_HEADER,
  LOCAL_PROOF_SERVER_HEADER,
  mintProof,
  REQUIRE_SERVER_PROOF_ENV,
  verifyCounterProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import type { DialPlan } from "./connection.js";

const CONNECT_TIMEOUT_MS = 10_000;

/** Read this HOME's local token, or `undefined` when there is none to present. */
export function readLocalToken(env?: { homedir?: string }): string | undefined {
  try {
    const value = fs.readFileSync(path.join(getDashboardConfigDir(env), "local", "token"), "utf-8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

interface ParsedEndpoint {
  /** Lowercased host with IPv6 brackets stripped. */
  host: string;
  port: number;
}

/** Parse a ws(s)/http(s) endpoint into `{host, port}` (default port applied), or `undefined`. */
function parseEndpoint(value: string): ParsedEndpoint | undefined {
  try {
    const u = new URL(value);
    const defaults: Record<string, number> = { "ws:": 80, "wss:": 443, "http:": 80, "https:": 443 };
    const fallback = defaults[u.protocol];
    if (fallback === undefined) return undefined;
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host) return undefined;
    return { host, port: u.port ? Number(u.port) : fallback };
  } catch {
    return undefined;
  }
}

/**
 * Does the spawn marker demand a server counter-proof on THIS dial?
 *
 * An empty/absent marker means unmarked. A marker that parses enforces only on
 * the same endpoint (host as a case-insensitive address literal, port after the
 * default — path, trailing slash and letter case are ignored). A non-empty
 * marker that cannot be parsed enforces on every loopback TCP dial (fail
 * closed). The caller has already established the dial is loopback TCP.
 */
export function markerEnforces(marker: string | undefined, dialEndpoint: string): boolean {
  if (marker === undefined || marker.trim() === "") return false;
  const m = parseEndpoint(marker.trim());
  if (!m) return true;
  const d = parseEndpoint(dialEndpoint);
  return !!d && d.host === m.host && d.port === m.port;
}

/** Open the TCP connection ourselves, with Node's default resolution. */
function defaultConnect(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connect to ${host}:${port} timed out`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export interface LocalCredentialPlanDeps {
  /** HOME override for the token location. */
  env?: { homedir?: string };
  /** The spawn marker; defaults to `process.env.PI_DASHBOARD_REQUIRE_SERVER_PROOF`. */
  marker?: string | undefined;
  /** Injectable TCP connector (default `net.connect`). */
  connect?: (host: string, port: number) => Promise<net.Socket>;
  /** Injectable clock / nonce for tests. */
  now?: () => number;
  nonce?: () => string;
}

/**
 * The dial plan for `endpoint`, or `undefined` when it gets no local credential
 * (unix socket, remote endpoint, TLS, or no token and no marker). Fresh on every
 * call: each dial carries its own timestamp and nonce.
 */
export async function localCredentialPlan(
  endpoint: string,
  deps: LocalCredentialPlanDeps = {},
): Promise<DialPlan | undefined> {
  if (endpoint.startsWith("ws+unix:")) return undefined;
  const target = parseEndpoint(endpoint);
  // Loopback means `localhost` or ANY `127/8` / `::1` literal — the same classifier
  // the spawner uses to mark an endpoint, so a marked `127.0.0.5` dial still gets a
  // proof and server verification (`isRemoteEndpoint` only knows 127.0.0.1).
  if (!target || !(target.host === "localhost" || isLoopbackLiteral(target.host))) return undefined;
  // `createConnection` hands `ws` a plain socket, so only a cleartext dial qualifies.
  if (new URL(endpoint).protocol !== "ws:") return undefined;

  const marker = "marker" in deps ? deps.marker : process.env[REQUIRE_SERVER_PROOF_ENV];
  const enforce = markerEnforces(marker, endpoint);
  const token = readLocalToken(deps.env);
  if (!token && !enforce) return undefined;

  const socket = await (deps.connect ?? defaultConnect)(target.host, target.port);
  let binding: string;
  try {
    if (!socket.remoteAddress || socket.remotePort === undefined) throw new Error("socket has no remote address");
    binding = canonicalBinding(socket.remoteAddress, socket.remotePort);
  } catch (err) {
    socket.destroy();
    throw err;
  }

  const plan: DialPlan = {
    createConnection: () => socket,
    dispose: () => socket.destroy(),
  };

  if (!token) {
    // Marked, but no token to prove with or verify against: fail closed.
    plan.verifyUpgrade = () => ({ ok: false, cause: "server-proof-missing" });
    return plan;
  }

  const minted = mintProof({
    token,
    binding,
    purpose: BRIDGE_PURPOSE,
    now: deps.now?.(),
    nonce: deps.nonce?.(),
  });
  plan.headers = { [LOCAL_PROOF_HEADER]: minted.header };
  if (enforce) {
    plan.verifyUpgrade = (res) => {
      const header = res.headers[LOCAL_PROOF_SERVER_HEADER.toLowerCase()];
      if (header === undefined || (Array.isArray(header) ? header.length === 0 : header === "")) {
        return { ok: false, cause: "server-proof-missing" };
      }
      return verifyCounterProof({ token, binding, nonce: minted.nonce, mac: minted.mac, header })
        ? { ok: true }
        : { ok: false, cause: "server-proof-invalid" };
    };
  }
  return plan;
}
