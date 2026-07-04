/**
 * Connect to a paired server.
 *
 * Identity-first: race the entry's `urls[]`, challenge each, and only accept a
 * url whose signed nonce verifies against the PINNED public key AND whose
 * fingerprint matches. A url that answers but fails verification is an
 * impostor and is REFUSED with a surfaced warning.
 *
 * Auth proof: hit an authenticated REST endpoint (`/api/paired-devices`) with
 * the bearer, then open the `/ws` socket using a FRESH single-use ticket
 * (minted per connect via `/api/ws-ticket`). The durable bearer never enters
 * the WS URL — only the short-lived ticket does.
 */

import { challengeIdentity, getJson, postJson } from "./protocol.js";
import type { KeyringEntry } from "./keyring.js";

export interface ConnectLog {
  ok: boolean;
  activeUrl?: string;
  lines: string[];
  /** Set when a reachable url proved a DIFFERENT identity than pinned. */
  identityMismatch?: string;
}

/** Convert an https origin to its wss form for the WS endpoint. */
function toWsUrl(base: string, ticket: string): string {
  const u = new URL(base);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.pathname = "/ws";
  u.search = `?ticket=${encodeURIComponent(ticket)}`;
  return u.toString();
}

/**
 * Find the first url that both responds and proves the pinned identity.
 * Returns the verified url, or throws with the mismatch detail.
 */
async function resolveVerifiedUrl(
  entry: KeyringEntry,
  log: string[],
): Promise<string> {
  let mismatch: string | undefined;
  // Race all urls; take the first that verifies against the pin.
  const attempts = entry.urls.map(async (url) => {
    const proof = await challengeIdentity(url);
    const pinned =
      proof.verified &&
      proof.fingerprint === entry.pinnedFingerprint &&
      proof.publicKey === entry.pinnedPubkey;
    if (!pinned) {
      mismatch = `${url}: ${proof.verified ? "identity mismatch" : "signature invalid"}`;
      throw new Error(mismatch);
    }
    return url;
  });

  try {
    const url = await Promise.any(attempts);
    log.push(`identity verified: ${url}`);
    return url;
  } catch {
    throw new Error(mismatch || "no reachable url proved the pinned identity");
  }
}

export async function connectServer(entry: KeyringEntry): Promise<ConnectLog> {
  const lines: string[] = [];
  try {
    const activeUrl = await resolveVerifiedUrl(entry, lines);

    // Prove the bearer works against an authenticated REST endpoint.
    const devices = await getJson<unknown[]>(activeUrl, "/api/paired-devices", entry.bearerToken);
    lines.push(`authenticated REST ok — ${Array.isArray(devices) ? devices.length : 0} paired device(s)`);

    // Fresh single-use ticket per (re)connect. Bearer stays out of the WS URL.
    const { ticket } = await postJson<{ ticket: string }>(
      activeUrl,
      "/api/ws-ticket",
      { scope: "browser" },
      entry.bearerToken,
    );
    lines.push("ws ticket minted");

    await openWs(toWsUrl(activeUrl, ticket), lines);
    return { ok: true, activeUrl, lines };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`error: ${message}`);
    return { ok: false, lines, identityMismatch: /mismatch|invalid/.test(message) ? message : undefined };
  }
}

function openWs(wsUrl: string, lines: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws connect timed out"));
    }, 10_000);
    ws.onopen = () => {
      clearTimeout(timer);
      lines.push("ws connected");
      ws.close();
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ws connect failed"));
    };
  });
}
