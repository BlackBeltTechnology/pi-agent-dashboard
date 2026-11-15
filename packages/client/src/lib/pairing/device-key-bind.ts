/**
 * "Key pending" bind (design D3/D9): a device that holds a credential but no key (paired before device
 * keys, or the server lost the key) binds one with a single `POST <route>/api/pair/device-key`, authed
 * by its own credential (bearer, or the device cookie on its own origin).
 *
 * - runs only where the page can hold a key (`detectDeviceKeySupport`: secure context + Ed25519) —
 *   a plain-http origin makes zero requests and stays "Paired · key pending"
 * - fresh challenge first; the route must prove the expected fingerprint (when one is pinned)
 * - at most one attempt per route per app start (module state); a failure is retried only on the next start
 * - a key created for a bind that failed is discarded again, so the next start can retry
 *
 * See change: device-key-mutual-check (tasks 5.3, D3, D9; test-plan X5).
 */
import type { DeviceProof } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { DEVICE_CHECK_TIMEOUT_MS, type ProveRoute, proveRoute } from "./device-check.js";
import { detectDeviceKeySupport, discardKey, ensureKey, hasKey, signDevbind } from "./device-key.js";

/** How the bind request authenticates: the stored bearer, or the same-origin httpOnly device cookie. */
export interface BindCredential {
  bearer?: string;
  cookie?: boolean;
}

export interface BindKeys {
  detect(): Promise<boolean>;
  hasKey(fingerprint: string): Promise<boolean>;
  ensureKey(fingerprint: string): Promise<string>;
  discardKey(fingerprint: string): Promise<void>;
  signDevbind(fingerprint: string, deviceNonce: string): Promise<DeviceProof | null>;
}

export interface BindOptions {
  route: string;
  credential: BindCredential;
  /** Pinned fingerprint; the challenge must prove it. Absent: whatever the route proves. */
  fingerprint?: string;
  fetchImpl?: typeof fetch;
  prove?: ProveRoute;
  keys?: BindKeys;
}

export type BindOutcome = "bound" | "unsupported" | "already-attempted" | "key-held" | "failed";

const defaultKeys: BindKeys = { detect: detectDeviceKeySupport, hasKey, ensureKey, discardKey, signDevbind };

const attempted = new Set<string>();

/** Forget which routes already tried this app start. For tests. */
export function resetDeviceKeyBindForTests(): void {
  attempted.clear();
}

export async function bindDeviceKeyOnce(opts: BindOptions): Promise<BindOutcome> {
  const keys = opts.keys ?? defaultKeys;
  if (!(await keys.detect())) return "unsupported";
  if (attempted.has(opts.route)) return "already-attempted";
  attempted.add(opts.route);

  let created: string | null = null;
  try {
    const proof = await proveRoute(opts.route, opts.fingerprint, { prove: opts.prove, timeoutMs: DEVICE_CHECK_TIMEOUT_MS });
    if (!proof?.deviceNonce) return "failed";
    const fingerprint = proof.fingerprint;
    if (await keys.hasKey(fingerprint)) return "key-held";
    await keys.ensureKey(fingerprint);
    created = fingerprint;
    const signed = await keys.signDevbind(fingerprint, proof.deviceNonce);
    if (!signed) throw new Error("no key to sign with");
    const { bearer, cookie } = opts.credential;
    const res = await (opts.fetchImpl ?? fetch)(`${opts.route.replace(/\/+$/, "")}/api/pair/device-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(cookie ? { credentials: "same-origin" as const } : {}),
      body: JSON.stringify({ deviceNonce: signed.deviceNonce, pub: signed.pub, sig: signed.sig }),
    });
    if (!res.ok) throw new Error(`bind refused (${res.status})`);
    return "bound";
  } catch {
    if (created) await keys.discardKey(created).catch(() => {});
    return "failed";
  }
}
