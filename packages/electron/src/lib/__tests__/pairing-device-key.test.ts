/**
 * Electron knock / code-redeem key lifecycle: the device key exists in memory from "Send request"
 * (or the redeem), rides the request body, and reaches the keyring only on approval.
 * See change: device-key-mutual-check (D3; test-plan X10).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  base64urlToBytes,
  DEVICE_NONCE_REUSE_MS,
  devbindMessage,
  rawEd25519PubToSpki,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeviceKey, generateDeviceKey } from "../device-key.js";
import { type ConnectingState, startPairing } from "../pairing-client.js";
import { startCodePairing } from "../pairing-code-client.js";
import { type CryptoPort, loadKeyring, type ServerKeyring } from "../server-keyring.js";

const F = `sha256:${"A".repeat(43)}`;
const BEARER = "BEARER-secret-token";
const CODE = "48217730";
const N1 = `${"a".repeat(42)}A`;
const N2 = `${"b".repeat(42)}A`;
const ref = { scheme: "http" as const, host: "192.168.16.204", port: 8000 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const crypto_: CryptoPort = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
};

let dir: string;
let keyring: ServerKeyring;
let states: ConnectingState[];
let key: DeviceKey;
let clock: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-dk-"));
  keyring = loadKeyring({ dir, crypto: crypto_, log: () => {} });
  states = [];
  key = generateDeviceKey();
  clock = 1_000;
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const settle = () => new Promise((r) => setTimeout(r, 0));
/** A poll-interval sleep that only ends when released: the request stays pending (the user waits). */
function gatedSleep() {
  const waiting: Array<() => void> = [];
  return { sleep: () => new Promise<void>((r) => waiting.push(r)), release: () => waiting.splice(0).forEach((r) => r()) };
}
const privateForms = (k: DeviceKey): string[] => {
  const der = Buffer.from(k.exportPrivate(), "base64");
  return [k.exportPrivate(), der.toString("base64url"), der.toString("hex"), der.subarray(-32).toString("base64"), der.subarray(-32).toString("base64url")];
};
/** Everything under the keyring dir, concatenated: no private key (in any form) may appear. */
const diskText = (): string =>
  fs
    .readdirSync(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
const expectNoKeyOnDisk = () => {
  expect(fs.readdirSync(dir)).toEqual([]);
  expect(keyring.has(F)).toBe(false);
  for (const form of privateForms(key)) expect(diskText()).not.toContain(form);
};

const verifySig = (pub: string, message: string, sig: string): boolean =>
  crypto.verify(
    null,
    Buffer.from(message),
    crypto.createPublicKey({ key: Buffer.from(rawEd25519PubToSpki(base64urlToBytes(pub))), format: "der", type: "spki" }),
    Buffer.from(base64urlToBytes(sig)),
  );

interface Net {
  polls?: Array<{ status: string; token?: string }>;
  expiresAt?: number;
}
function stubNet(n: Net = {}) {
  const polls = [...(n.polls ?? [{ status: "pending" }, { status: "approved", token: BEARER }])];
  const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/pair/request")) return json(200, { success: true, data: { pendingId: "p1", confirmCode: CODE, expiresAt: n.expiresAt ?? 9_999_999, fingerprint: F } });
    if (u.endsWith("/api/pair/redeem")) return json(200, { success: true, data: { pendingId: "p1", confirmCode: CODE } });
    if (u.endsWith("/api/pair/poll")) {
      return json(200, { success: true, data: polls.shift() ?? { status: "pending" } });
    }
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const bodyOf = (f: ReturnType<typeof vi.fn>, suffix: string) => {
  const call = f.mock.calls.find(([u]) => String(u).endsWith(suffix));
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as { deviceKey?: { deviceNonce: string; pub: string; sig: string } }) : undefined;
};

/** A prover answering a fresh nonce each call. */
function nonceProver() {
  const nonces = [N1, N2];
  return vi.fn(async (_url: string) => ({ proven: F, publicKey: "PUBKEY", deviceNonce: nonces.shift() ?? N2 }));
}

function knock(prove: ReturnType<typeof nonceProver>, extra: Partial<Parameters<typeof startPairing>[1]> = {}) {
  return startPairing(
    { label: "home-imac", ref, deviceName: "my-mac", advertFp: F },
    { prove: prove as never, keyring, log: () => {}, onState: (s) => states.push(s), now: () => clock, sleep: async () => {}, generateKey: () => key, ...extra },
  );
}

describe("X10: knock — challenge freshness at Send request", () => {
  it.each([
    ["29.9 s old ⇒ reused", DEVICE_NONCE_REUSE_MS - 100, 1, N1],
    ["30.1 s old ⇒ re-run", DEVICE_NONCE_REUSE_MS + 100, 2, N2],
  ])("%s", async (_n, age, proves, nonce) => {
    const f = stubNet();
    const prove = nonceProver();
    const s = knock(prove);
    await settle();
    clock += age; // the user sits on the confirm screen
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(prove).toHaveBeenCalledTimes(proves);
    const dk = bodyOf(f, "/api/pair/request")?.deviceKey;
    expect(dk).toMatchObject({ deviceNonce: nonce, pub: key.pub });
    expect(verifySig(dk!.pub, devbindMessage(F, nonce), dk!.sig)).toBe(true);
  });

  it("the re-run challenge goes to the literal that proved the pin, and a re-run proving another identity sends nothing", async () => {
    const f = stubNet();
    const prove = vi
      .fn()
      .mockResolvedValueOnce({ proven: F, publicKey: "PUBKEY", deviceNonce: N1 })
      .mockResolvedValueOnce({ proven: `sha256:${"B".repeat(43)}`, deviceNonce: N2 });
    const s = knock(prove as never);
    await settle();
    clock += DEVICE_NONCE_REUSE_MS + 1;
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(prove.mock.calls.map(([u]) => u)).toEqual(["http://192.168.16.204:8000", "http://192.168.16.204:8000"]);
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/pair/request"))).toBe(false);
    expectNoKeyOnDisk();
  });
});

describe("X10: knock — the key reaches the keyring only on approval", () => {
  it("nothing is on disk or in the keyring before approval (waiting phase)", async () => {
    stubNet({ polls: [] });
    const gate = gatedSleep();
    const s = knock(nonceProver(), { sleep: gate.sleep });
    await settle();
    s.send("Laptop");
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("waiting"));
    expectNoKeyOnDisk();
    s.stop();
    gate.release();
    await s.done;
  });

  it("approval: entry holds bearer + key, private part encrypted, no clear private key in the file, mode 0600", async () => {
    stubNet();
    const s = knock(nonceProver());
    await settle();
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(keyring.bearerFor(F)).toBe(BEARER);
    expect(keyring.deviceKeyFor(F)?.pub).toBe(key.pub);
    const file = path.join(dir, "server-keyring.json");
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).toContain(key.pub);
    expect(raw).not.toContain(BEARER);
    for (const form of privateForms(key)) expect(raw).not.toContain(form);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadKeyring({ dir, crypto: crypto_, log: () => {} }).deviceKeyFor(F)?.exportPrivate()).toBe(key.exportPrivate());
  });

  it.each([
    ["rejected", { polls: [{ status: "pending" }, { status: "rejected" }] }, "rejected"],
    ["ended by the server", { polls: [{ status: "expired" }] }, "expired"],
  ])("%s ⇒ no keyring file, no entry, no private key anywhere", async (_n, net, status) => {
    stubNet(net);
    const s = knock(nonceProver());
    await settle();
    s.send("Laptop");
    expect(await s.done).toEqual({ status });
    expectNoKeyOnDisk();
  });

  it("expiry (300 s elapsed while waiting) ⇒ nothing stored", async () => {
    stubNet({ expiresAt: clock + 300_000, polls: [] });
    const s = knock(nonceProver(), {
      sleep: async () => {
        clock += 300_000;
      },
    });
    await settle();
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "expired" });
    expectNoKeyOnDisk();
  });

  it("Stop waiting ⇒ nothing stored", async () => {
    stubNet({ polls: [] });
    const gate = gatedSleep();
    const s = knock(nonceProver(), { sleep: gate.sleep });
    await settle();
    s.send("Laptop");
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("waiting"));
    s.stop();
    gate.release();
    expect(await s.done).toEqual({ status: "stopped" });
    expectNoKeyOnDisk();
  });

  it("simulated quit mid-poll: at the moment the process would die the keyring dir holds nothing", async () => {
    stubNet({ polls: [] });
    const gate = gatedSleep();
    const s = knock(nonceProver(), { sleep: gate.sleep });
    await settle();
    s.send("Laptop");
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("waiting"));
    await settle();
    expectNoKeyOnDisk(); // the poll is still pending: this is the state a crash would leave behind
    s.stop();
    gate.release();
    await s.done;
  });

  it("a server that does not offer a device nonce gets a keyless knock and the entry holds no key", async () => {
    const f = stubNet();
    const s = knock(vi.fn(async () => ({ proven: F, publicKey: "PUBKEY" })) as never);
    await settle();
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "Laptop" });
    expect(keyring.get(F)).toMatchObject({ keyHeld: false, needsPairing: false });
  });

  it("safeStorage unavailable: approval keeps bearer and key in memory only, the window can still open", async () => {
    keyring = loadKeyring({ dir, crypto: { ...crypto_, isEncryptionAvailable: () => false }, log: () => {} });
    stubNet();
    const s = knock(nonceProver());
    await settle();
    s.send("Laptop");
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(keyring.bearerFor(F)).toBe(BEARER);
    expect(keyring.deviceKeyFor(F)?.pub).toBe(key.pub);
    expect(keyring.get(F)).toMatchObject({ remembered: false });
    for (const form of privateForms(key)) expect(diskText()).not.toContain(form);
    expect(diskText()).not.toContain(BEARER);
  });
});

describe("X10: code redeem — same lifecycle", () => {
  const U1 = "https://one.share.zrok.io";
  const copy = `pi:pair:v1.${Buffer.from(JSON.stringify({ v: 1, id: F, code: "PAIR-ZZ9", urls: [U1] })).toString("base64url")}`;
  const redeem = (prove: ReturnType<typeof nonceProver>) =>
    startCodePairing(
      { fingerprint: F, label: "build-box", deviceName: "my-mac" },
      { prove: prove as never, keyring, log: () => {}, onState: (s) => states.push(s), now: () => clock, sleep: async () => {}, generateKey: () => key },
    );

  it("the redeem body carries the key; it is stored on approval only", async () => {
    const f = stubNet();
    const prove = nonceProver();
    const s = redeem(prove);
    await settle();
    s.submitCode(copy);
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    const dk = bodyOf(f, "/api/pair/redeem")?.deviceKey;
    expect(dk).toMatchObject({ deviceNonce: N1, pub: key.pub });
    expect(verifySig(dk!.pub, devbindMessage(F, N1), dk!.sig)).toBe(true);
    expect(keyring.deviceKeyFor(F)?.pub).toBe(key.pub);
    for (const form of privateForms(key)) expect(diskText()).not.toContain(form);
  });

  it("a redeem proven 30.1 s ago re-runs the challenge; a rejected request stores nothing", async () => {
    stubNet({ polls: [{ status: "rejected" }] });
    const prove = nonceProver();
    let first = true;
    const slow = vi.fn(async (u: string) => {
      const r = await prove(u);
      if (first) {
        first = false;
        clock += DEVICE_NONCE_REUSE_MS + 100; // proving took long (several origins tried)
      }
      return r;
    });
    const s = redeem(slow as never);
    await settle();
    s.submitCode(copy);
    expect(await s.done).toEqual({ status: "rejected" });
    expect(slow).toHaveBeenCalledTimes(2);
    expectNoKeyOnDisk();
  });
});
