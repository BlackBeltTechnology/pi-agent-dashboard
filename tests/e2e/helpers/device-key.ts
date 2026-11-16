/**
 * Test-side device key for the device-key-mutual-check L3 specs: an Ed25519 key signed with
 * `node:crypto` (so no spec depends on the browser's WebCrypto), the three proof message
 * formats written out LITERALLY (an independent restatement of the wire contract, not an
 * import of the shared builders), and thin REST helpers against the harness.
 *
 * Wire contract (design D1/D3/D5):
 *   status proof   sig over `pi-devcheck/v2\n<fingerprint>\n<deviceNonce>`
 *   bind proof     sig over `pi-devbind/v1\n<fingerprint>\n<deviceNonce>`
 *   companion      sig over `pi-companion/v1\n<fingerprint>\n<origin>\n<ts>` (ts = integer seconds)
 * `pub` is the raw 32-byte Ed25519 public key, unpadded base64url.
 *
 * See change: device-key-mutual-check (test-plan F7, F8, X15).
 */
import crypto from "node:crypto";
import { operatorHeaders } from "./bridge-credential.js";

export interface E2eDeviceKey {
  /** Raw 32-byte public key, unpadded base64url. */
  pub: string;
  sign(message: string): string;
}

export function newDeviceKey(): E2eDeviceKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = (publicKey.export({ format: "jwk" }) as { x: string }).x;
  return { pub, sign: (m) => crypto.sign(null, Buffer.from(m, "utf8"), privateKey).toString("base64url") };
}

interface Challenge {
  fingerprint: string;
  deviceNonce: string;
}

/** `POST /api/pair/challenge` — a fresh single-use device nonce plus the server fingerprint. */
async function fetchChallenge(base: string): Promise<Challenge> {
  const res = await fetch(`${base}/api/pair/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce: crypto.randomBytes(16).toString("base64url") }),
  });
  const json = (await res.json()) as { success: boolean; data?: Challenge };
  if (!json.success || !json.data?.deviceNonce || !json.data.fingerprint) {
    throw new Error(`challenge failed: ${JSON.stringify(json)}`);
  }
  return { fingerprint: json.data.fingerprint, deviceNonce: json.data.deviceNonce };
}

/** `{deviceNonce, pub, sig}` for the bind proof (knock / redeem `deviceKey`). */
async function bindProof(base: string, key: E2eDeviceKey): Promise<{ deviceNonce: string; pub: string; sig: string }> {
  const { fingerprint, deviceNonce } = await fetchChallenge(base);
  return { deviceNonce, pub: key.pub, sig: key.sign(`pi-devbind/v1\n${fingerprint}\n${deviceNonce}`) };
}

/** The `#companion=…&from=…` fragment a companion origin would append to the request landing URL. */
export async function companionFragment(base: string, key: E2eDeviceKey, origin: string): Promise<string> {
  const { fingerprint } = await fetchChallenge(base);
  const ts = Math.floor(Date.now() / 1000);
  const sig = key.sign(`pi-companion/v1\n${fingerprint}\n${origin}\n${ts}`);
  return `#companion=${key.pub}.${ts}.${sig}&from=${encodeURIComponent(origin)}`;
}

export interface DeviceStatusAnswer {
  status: "paired" | "expired" | "unknown" | "revoked" | "unverified";
  tier?: string;
  scope?: string;
}

/** Fresh challenge → status proof → `POST /api/pair/device-status`. Counts against the per-peer limiter (60/min). */
export async function deviceStatus(base: string, key: E2eDeviceKey): Promise<DeviceStatusAnswer> {
  const { fingerprint, deviceNonce } = await fetchChallenge(base);
  const res = await fetch(`${base}/api/pair/device-status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceNonce, pub: key.pub, sig: key.sign(`pi-devcheck/v2\n${fingerprint}\n${deviceNonce}`) }),
  });
  return (await res.json()) as DeviceStatusAnswer;
}

async function postJson(base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Pair a device that holds `key` through the real redeem → approve → poll path (no knock, so it does
 * not spend the shared source's knock budget) and return its durable bearer.
 */
export async function pairKeyedDevice(base: string, key: E2eDeviceKey, label: string): Promise<{ token: string }> {
  const payload = await (await fetch(`${base}/api/pair/payload`, { headers: operatorHeaders() })).json();
  const code = payload?.data?.code;
  if (!code) throw new Error(`pairing payload had no code: ${JSON.stringify(payload)}`);
  const redeemed = await postJson(base, "/api/pair/redeem", { code, deviceKey: await bindProof(base, key) });
  const { pendingId, confirmCode } = redeemed?.data ?? {};
  if (!pendingId) throw new Error(`redeem failed: ${JSON.stringify(redeemed)}`);
  const approved = await postJson(base, "/api/pair/approve", { code, confirmCode, label }, operatorHeaders());
  if (!approved?.success) throw new Error(`approve failed: ${JSON.stringify(approved)}`);
  const polled = await postJson(base, "/api/pair/poll", { pendingId });
  const token = polled?.data?.token;
  if (!token) throw new Error(`poll returned no token: ${JSON.stringify(polled)}`);
  return { token };
}

export interface PairedDeviceRow {
  id: string;
  label: string;
  tier: string;
  keyId?: string;
  companions?: { id: string; origin: string; createdAt: number }[];
}

export async function listPairedDevices(base: string): Promise<PairedDeviceRow[]> {
  const res = await fetch(`${base}/api/paired-devices`, { headers: operatorHeaders() });
  return ((await res.json()).data ?? []) as PairedDeviceRow[];
}

/** Revoke then delete for good every device whose label starts with `prefix` (best effort, idempotent). */
export async function purgeDevices(base: string, prefix: string): Promise<void> {
  const headers = operatorHeaders();
  for (const d of await listPairedDevices(base)) {
    if (d.label.startsWith(prefix)) await fetch(`${base}/api/paired-devices/${d.id}`, { method: "DELETE", headers });
  }
  const res = await fetch(`${base}/api/paired-devices/revoked`, { headers });
  const revoked = ((await res.json()).data ?? []) as { id: string; label: string }[];
  for (const d of revoked) {
    if (d.label.startsWith(prefix)) await fetch(`${base}/api/paired-devices/revoked/${d.id}`, { method: "DELETE", headers });
  }
}

/**
 * Status of a bearer-guarded REST read (`GET /api/paired-devices`, `networkGuard`) with the device bearer:
 * 200 while the device is active, otherwise the refusal. (`GET /api/sessions` is not a usable probe: the
 * harness answers it for anyone, so it cannot tell a revoked bearer from a valid one.)
 */
export async function guardedStatus(base: string, token: string): Promise<number> {
  return (await fetch(`${base}/api/paired-devices`, { headers: { authorization: `Bearer ${token}` } })).status;
}

/**
 * Open a dashboard browser socket as the device (single-use ticket minted with its bearer) and expose
 * its lifecycle as promises — no polling, no fixed delays.
 */
export async function openDeviceSocket(
  base: string,
  token: string,
): Promise<{ opened: Promise<void>; closed: Promise<{ code: number; reason: string }>; close(): void }> {
  const res = await fetch(`${base}/api/ws-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ scope: "browser" }),
  });
  const ticket = (await res.json())?.data?.ticket;
  if (!ticket) throw new Error(`ticket mint failed (${res.status})`);
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws?ticket=${encodeURIComponent(ticket)}`);
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("device socket error before open")));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason }));
  });
  return { opened, closed, close: () => ws.close() };
}

/**
 * Restart the server as the operator (the plain `restartDashboard` helper sends no credential, which a
 * narrowed-trust harness refuses) and wait until it answers again. Used to start a spec with the
 * in-memory knock limiter and pending-request list empty, whatever ran before it.
 */
export async function restartServerAsOperator(base: string): Promise<void> {
  const res = await fetch(`${base}/api/restart`, { method: "POST", headers: operatorHeaders() }).catch(() => undefined);
  if (res && !res.ok) throw new Error(`restart refused: ${res.status}`);
  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}
