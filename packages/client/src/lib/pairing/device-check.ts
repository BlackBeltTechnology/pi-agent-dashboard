/**
 * Browser half of the two-step device check (design D1/D9): challenge the route, and only when it
 * proved the expected fingerprint AND this page holds a key for it, send one signed
 * `POST <route>/api/pair/device-status`. Nothing is ever discarded in here: the result is advisory.
 *
 * - no key held → exactly the challenge, no proof request
 * - route unproven (other fingerprint, timeout, 500, 403, bad signature) → zero device-status POSTs
 * - challenge without `deviceNonce` (older server) → `no-nonce`
 * - reset / 500 / non-JSON / unrecognised body → `answer` `unverified`; transport error or abort → `no-answer`
 *
 * Both requests carry a 2 s client timeout (aborted at 2.0 s). Dependencies are injectable so tests run
 * without IndexedDB or WebCrypto.
 *
 * See change: device-key-mutual-check (tasks 5.1, D1, D9; test-plan X1–X3).
 */
import {
  type DeviceCheckReply,
  type DeviceProof,
  parseDeviceStatusReply,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { hasKey, signDevcheck } from "./device-key.js";
import { challengeIdentity, type IdentityProof } from "./pair-protocol.js";

/** Client timeout for each of the two requests (test-plan G1). */
export const DEVICE_CHECK_TIMEOUT_MS = 2_000;

export type ProveRoute = (route: string, timeoutMs: number) => Promise<IdentityProof>;

export interface DeviceCheckKeys {
  hasKey(fingerprint: string): Promise<boolean>;
  signDevcheck(fingerprint: string, deviceNonce: string): Promise<DeviceProof | null>;
}

export interface DeviceCheckOptions {
  /** Base URL of the route under check (no trailing path). */
  route: string;
  /** The fingerprint the route must prove (pin or advert). */
  fingerprint: string;
  fetchImpl?: typeof fetch;
  /** Identity challenge; defaults to `challengeIdentity`. */
  prove?: ProveRoute;
  keys?: DeviceCheckKeys;
  timeoutMs?: number;
}

const defaultProve: ProveRoute = (route, timeoutMs) => challengeIdentity(route, timeoutMs);
const defaultKeys: DeviceCheckKeys = { hasKey, signDevcheck };

/**
 * Challenge `route`; the proof when it verified AND names `fingerprint` (or any, when `fingerprint`
 * is undefined), otherwise null. Never throws.
 */
export async function proveRoute(
  route: string,
  fingerprint: string | undefined,
  opts: { prove?: ProveRoute; timeoutMs?: number } = {},
): Promise<IdentityProof | null> {
  try {
    const proof = await (opts.prove ?? defaultProve)(route, opts.timeoutMs ?? DEVICE_CHECK_TIMEOUT_MS);
    if (!proof.verified) return null;
    return fingerprint === undefined || proof.fingerprint === fingerprint ? proof : null;
  } catch {
    return null;
  }
}

async function postDeviceStatus(route: string, proof: DeviceProof, fetchImpl: typeof fetch, timeoutMs: number): Promise<DeviceCheckReply> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${route.replace(/\/+$/, "")}/api/pair/device-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceNonce: proof.deviceNonce, pub: proof.pub, sig: proof.sig }),
      signal: ac.signal,
    });
    if (res.status !== 200) return { kind: "answer", status: "unverified" };
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON → unverified */
    }
    return { kind: "answer", ...parseDeviceStatusReply(body) };
  } catch {
    return { kind: "no-answer" };
  } finally {
    clearTimeout(timer);
  }
}

/** Run the two-step device check against one route. Never throws; never discards anything. */
export async function runDeviceCheck(opts: DeviceCheckOptions): Promise<DeviceCheckReply> {
  const timeoutMs = opts.timeoutMs ?? DEVICE_CHECK_TIMEOUT_MS;
  const keys = opts.keys ?? defaultKeys;
  const proof = await proveRoute(opts.route, opts.fingerprint, { prove: opts.prove, timeoutMs });
  if (!proof) return { kind: "no-answer" };
  if (!proof.deviceNonce) return { kind: "no-nonce" };
  try {
    if (!(await keys.hasKey(opts.fingerprint))) return { kind: "no-answer" };
    const signed = await keys.signDevcheck(opts.fingerprint, proof.deviceNonce);
    if (!signed) return { kind: "no-answer" };
    return await postDeviceStatus(opts.route, signed, opts.fetchImpl ?? fetch, timeoutMs);
  } catch {
    return { kind: "no-answer" };
  }
}
