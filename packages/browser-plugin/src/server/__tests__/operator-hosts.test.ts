/**
 * OperatorHostRegistry (change: add-operator-browser-relay, task 7.1; design
 * D2) — test-plan #E1–#E7, #E10, #E11, #X7.
 *
 * Driven with a `FakeSocket` carrier per client and real Ed25519 key pairs, the
 * same way the gateway hands a `/ws` socket to a registered browser handler.
 */
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHostSignedMessage,
  hostIdFromPublicKey,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditRing } from "../audit.js";
import { OperatorHostRegistry } from "../operator-hosts.js";
import { FakeSocket } from "../relay/__tests__/fake-socket.js";

const SERVER_ID = "server-I";
const DAY = 86_400_000;

interface Identity {
  hostId: string;
  publicKey: string;
  privateKey: KeyObject;
}

function makeIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { hostId: hostIdFromPublicKey(pub), publicKey: pub, privateKey };
}

function signFor(id: Identity, nonce: string, serverId: string): string {
  return sign(null, Buffer.from(buildHostSignedMessage(nonce, serverId)), id.privateKey).toString("base64");
}

const PROFILES = [{ profileDirectory: "Default", label: "Me", installed: true }];

let dir: string;
let now: number;
let logs: string[];
let audit: AuditRing;
let gone: Array<{ hostId: string; socket: unknown }>;
let activity: Set<string>;

function makeRegistry(pinsPath = join(dir, "operator-hosts.json")) {
  return new OperatorHostRegistry({
    pinsPath,
    getServerId: () => SERVER_ID,
    audit,
    logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) },
    now: () => now,
    onHostGone: (hostId, socket) => gone.push({ hostId, socket }),
    hasActivity: (hostId) => activity.has(hostId),
  });
}

/** hello → challenge → register as `id` over `ws`; returns the register payload sender. */
async function handshake(
  reg: OperatorHostRegistry,
  ws: FakeSocket,
  id: Identity,
  over: Record<string, unknown> = {},
  signAs: { key?: Identity; serverId?: string } = {},
): Promise<void> {
  await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
  const challenge = ws.json().findLast((m) => m.type === "browser_host_challenge");
  if (!challenge) return;
  await reg.handle(
    {
      type: "browser_host_register",
      hostId: id.hostId,
      signature: signFor(signAs.key ?? id, challenge.nonce as string, signAs.serverId ?? (challenge.serverId as string)),
      label: "mac-home",
      platform: "darwin",
      canOpenChrome: true,
      profiles: PROFILES,
      ...over,
    },
    ws,
  );
}

const registered = (ws: FakeSocket) => ws.json().filter((m) => m.type === "browser_host_registered");
const pinFile = (): { pins: Record<string, { publicKey: string; lastSeen: number }> } =>
  JSON.parse(readFileSync(join(dir, "operator-hosts.json"), "utf-8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "operator-hosts-"));
  now = 1_700_000_000_000;
  logs = [];
  audit = new AuditRing();
  gone = [];
  activity = new Set();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("registration (E1)", () => {
  it("hello → challenge{nonce, serverId} → register → registered, unicast to the carrier", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const carrier = new FakeSocket();
    const other = new FakeSocket();
    await handshake(reg, carrier, id);

    const challenge = carrier.json().find((m) => m.type === "browser_host_challenge")!;
    expect(challenge.serverId).toBe(SERVER_ID);
    expect(challenge.nonce).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes
    expect(registered(carrier)).toEqual([{ type: "browser_host_registered", hostId: id.hostId }]);
    expect(other.sent).toHaveLength(0);

    expect(reg.list()).toEqual([
      {
        hostId: id.hostId,
        label: "mac-home",
        platform: "darwin",
        online: true,
        canOpenChrome: true,
        profiles: PROFILES,
      },
    ]);
    expect(logs).toContain(`[browser-host] register host=${id.hostId} profiles=1 pin=new`);
  });

  it("each hello gets a fresh nonce", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
    await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
    const nonces = ws.json().map((m) => m.nonce);
    expect(new Set(nonces).size).toBe(2);
  });

  it("a challenge is single-use: replaying a valid register is refused", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
    const c = ws.json()[0];
    const register = {
      type: "browser_host_register",
      hostId: id.hostId,
      signature: signFor(id, c.nonce as string, SERVER_ID),
      label: "x",
      platform: "darwin",
      canOpenChrome: true,
      profiles: PROFILES,
    };
    await reg.handle(register, ws);
    const second = new FakeSocket();
    await reg.handle(register, second); // replay on another socket: no challenge issued to it
    expect(registered(second)).toHaveLength(0);
  });

  it("a register without a prior hello is refused", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle(
      { type: "browser_host_register", hostId: id.hostId, signature: "AAAA", label: "x", platform: "darwin", canOpenChrome: true, profiles: [] },
      ws,
    );
    expect(registered(ws)).toHaveLength(0);
    expect(reg.list()).toEqual([]);
  });
});

describe("hostId derivation (E2)", () => {
  it("hostId that does not derive from the key is refused and audited under host:<claimed>", async () => {
    const reg = makeRegistry();
    const real = makeIdentity();
    const claimed = makeIdentity().hostId; // someone else's well-formed id
    const ws = new FakeSocket();
    await handshake(reg, ws, { ...real, hostId: claimed });
    expect(registered(ws)).toHaveLength(0);
    expect(reg.list()).toEqual([]);
    const entries = audit.list(`host:${claimed}`);
    expect(entries.map((e) => e.detail)).toContain("browser_host:register");
    expect(entries[0].kind).toBe("denied");
  });

  it("a malformed hostId is audited under host:invalid, never echoed", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle({ type: "browser_host_hello", hostId: "evil\nhost", publicKey: id.publicKey }, ws);
    expect(ws.sent).toHaveLength(0);
    expect(audit.list("host:invalid")).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain("evil");
  });
});

describe("pinning (E3)", () => {
  it("another key claiming a pinned hostId is refused; the live binding is untouched", async () => {
    const reg = makeRegistry();
    const k1 = makeIdentity();
    const a = new FakeSocket();
    await handshake(reg, a, k1);
    activity.add(k1.hostId);

    const k2 = makeIdentity();
    const b = new FakeSocket();
    await handshake(reg, b, { ...k2, hostId: k1.hostId });
    expect(registered(b)).toHaveLength(0);
    expect(logs.some((l) => l.includes(`host=${k1.hostId}`) && l.includes("pin=mismatch"))).toBe(true);
    expect(audit.list(`host:${k1.hostId}`).some((e) => e.detail === "browser_host:register")).toBe(true);
    expect(reg.get(k1.hostId)?.socket).toBe(a);
    expect(gone).toHaveLength(0);
  });

  it("a tampered pin file (different key for the hostId) refuses the real key with pin=mismatch", async () => {
    const id = makeIdentity();
    const other = makeIdentity();
    writeFileSync(
      join(dir, "operator-hosts.json"),
      JSON.stringify({ pins: { [id.hostId]: { publicKey: other.publicKey, lastSeen: now } } }),
    );
    const reg = makeRegistry();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    expect(registered(ws)).toHaveLength(0);
    expect(logs.some((l) => l.includes("pin=mismatch"))).toBe(true);
  });
});

describe("serverId binding (E4)", () => {
  it("a signature over a different serverId is refused", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id, {}, { serverId: "server-J" });
    expect(registered(ws)).toHaveLength(0);
    expect(reg.list()).toEqual([]);
    expect(audit.list(`host:${id.hostId}`).map((e) => e.detail)).toContain("browser_host:register");
  });

  it("a signature by another key is refused", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id, {}, { key: makeIdentity() });
    expect(registered(ws)).toHaveLength(0);
  });

  it("an unavailable server id refuses the hello (no challenge without our identity)", async () => {
    const reg = new OperatorHostRegistry({
      pinsPath: join(dir, "p.json"),
      getServerId: () => Promise.reject(new Error("health down")),
      audit,
      logger: { info() {}, warn() {}, error() {} },
      onHostGone: () => {},
      hasActivity: () => false,
    });
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
    expect(ws.sent).toHaveLength(0);
  });
});

describe("one host per socket, host-active, re-bind (E5, E6)", () => {
  it("a second socket for a host with live activity is refused host-active; the first stays bound", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await handshake(reg, a, id);
    activity.add(id.hostId);
    await handshake(reg, b, id);
    expect(registered(b)).toHaveLength(0);
    expect(reg.get(id.hostId)?.socket).toBe(a);
    expect(gone).toHaveLength(0);
    expect(a.closed).toHaveLength(0);
    expect(logs.some((l) => l.includes("refused") && l.includes("host-active"))).toBe(true);
  });

  it("without links or pending connects a verified register re-binds to the newcomer", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await handshake(reg, a, id);
    await handshake(reg, b, id);
    expect(registered(b)).toHaveLength(1);
    expect(reg.get(id.hostId)?.socket).toBe(b);
    expect(reg.list()).toHaveLength(1);
    // the old socket is no longer a host; closing it must not drop the new binding
    a.close(1000, "x");
    expect(reg.get(id.hostId)?.socket).toBe(b);
    expect(gone).toHaveLength(0);
  });

  it("A closes, then B registers → bound to B, online", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await handshake(reg, a, id);
    activity.add(id.hostId);
    a.close(1006, "gone");
    expect(gone).toEqual([{ hostId: id.hostId, socket: a }]);
    expect(reg.list()).toEqual([]);
    activity.delete(id.hostId);
    await handshake(reg, b, id);
    expect(reg.get(id.hostId)?.socket).toBe(b);
    expect(reg.list()[0].online).toBe(true);
  });

  it("a socket holds at most one host", async () => {
    const reg = makeRegistry();
    const one = makeIdentity();
    const two = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, one);
    await handshake(reg, ws, two);
    expect(reg.list().map((h) => h.hostId)).toEqual([one.hostId]);
  });

  it("re-registering the same host on the same socket refreshes its rows", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    await handshake(reg, ws, id, { label: "renamed" });
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].label).toBe("renamed");
  });
});

describe("bounds (E7)", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ profileDirectory: `P${i}`, label: `L${i}`, installed: true }));

  async function tryRegister(over: Record<string, unknown>): Promise<{ ok: boolean; reg: OperatorHostRegistry; id: Identity }> {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id, over);
    return { ok: registered(ws).length === 1, reg, id };
  }

  it("profiles 64 ok / 65 refused", async () => {
    expect((await tryRegister({ profiles: rows(64) })).ok).toBe(true);
    const r = await tryRegister({ profiles: rows(65) });
    expect(r.ok).toBe(false);
    expect(r.reg.list()).toEqual([]);
  });

  it("label 128 ok / 129 refused", async () => {
    expect((await tryRegister({ label: "a".repeat(128) })).ok).toBe(true);
    expect((await tryRegister({ label: "a".repeat(129) })).ok).toBe(false);
  });

  it("profileDirectory with a path separator refused (both separators), 128 chars ok / 129 refused", async () => {
    const one = (profileDirectory: string) => [{ profileDirectory, label: "x", installed: true }];
    expect((await tryRegister({ profiles: one("a/b") })).ok).toBe(false);
    expect((await tryRegister({ profiles: one("a\\b") })).ok).toBe(false);
    expect((await tryRegister({ profiles: one("d".repeat(128)) })).ok).toBe(true);
    expect((await tryRegister({ profiles: one("d".repeat(129)) })).ok).toBe(false);
  });

  it("email 254 ok / 255 refused", async () => {
    const one = (email: string) => [{ profileDirectory: "Default", label: "x", installed: true, email }];
    expect((await tryRegister({ profiles: one("e".repeat(254)) })).ok).toBe(true);
    expect((await tryRegister({ profiles: one("e".repeat(255)) })).ok).toBe(false);
  });

  it("wrong types are refused", async () => {
    expect((await tryRegister({ label: 5 })).ok).toBe(false);
    expect((await tryRegister({ profiles: "nope" })).ok).toBe(false);
    expect((await tryRegister({ canOpenChrome: "yes" })).ok).toBe(false);
    expect((await tryRegister({ profiles: [{ profileDirectory: "Default", label: "x", installed: "y" }] })).ok).toBe(false);
  });

  it("listed rows carry only the four registered fields (nothing smuggled)", async () => {
    const { reg, id } = await tryRegister({
      profiles: [{ profileDirectory: "Default", label: "x", installed: true, hasToken: true, token: "T0KEN" }],
    });
    expect(reg.get(id.hostId)?.profiles).toEqual([{ profileDirectory: "Default", label: "x", installed: true }]);
  });
});

describe("pin file (E10, E11, X7)", () => {
  it("prunes pins older than 90 days and caps at 256, dropping the least recent", async () => {
    const pins: Record<string, { publicKey: string; lastSeen: number }> = {};
    for (let i = 0; i < 257; i++) {
      pins[`host-${String(i).padStart(32, "0")}`] = { publicKey: `k${i}`, lastSeen: now - 1000 - i };
    }
    const stale = `host-${"f".repeat(32)}`;
    pins[stale] = { publicKey: "old", lastSeen: now - 91 * DAY };
    writeFileSync(join(dir, "operator-hosts.json"), JSON.stringify({ pins }));

    const reg = makeRegistry();
    const id = makeIdentity();
    await handshake(reg, new FakeSocket(), id);

    const saved = pinFile().pins;
    expect(Object.keys(saved).length).toBeLessThanOrEqual(256);
    expect(saved[stale]).toBeUndefined();
    expect(saved[id.hostId].publicKey).toBe(id.publicKey);
    // least recently seen of the survivors went first
    expect(saved[`host-${String(256).padStart(32, "0")}`]).toBeUndefined();
    expect(saved[`host-${String(0).padStart(32, "0")}`]).toBeDefined();
  });

  it("a 89-day-old pin survives", async () => {
    const keep = `host-${"a".repeat(32)}`;
    writeFileSync(
      join(dir, "operator-hosts.json"),
      JSON.stringify({ pins: { [keep]: { publicKey: "k", lastSeen: now - 89 * DAY } } }),
    );
    const reg = makeRegistry();
    await handshake(reg, new FakeSocket(), makeIdentity());
    expect(pinFile().pins[keep]).toBeDefined();
  });

  it("DELETE-style reset removes the pin; the host then registers and pins again (pin=new)", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    await handshake(reg, new FakeSocket(), id);
    expect(pinFile().pins[id.hostId]).toBeDefined();
    expect(reg.deletePin(id.hostId)).toBe(true);
    expect(pinFile().pins[id.hostId]).toBeUndefined();
    expect(reg.deletePin(id.hostId)).toBe(false);

    logs.length = 0;
    await handshake(reg, new FakeSocket(), id);
    expect(logs).toContain(`[browser-host] register host=${id.hostId} profiles=1 pin=new`);
    expect(pinFile().pins[id.hostId].publicKey).toBe(id.publicKey);
  });

  it("a fresh registry over an existing pin file: no host online, a register with the pinned key is pin=ok", async () => {
    const first = makeRegistry();
    const id = makeIdentity();
    await handshake(first, new FakeSocket(), id);

    const fresh = makeRegistry();
    expect(fresh.list()).toEqual([]);
    logs.length = 0;
    const ws = new FakeSocket();
    await handshake(fresh, ws, id);
    expect(registered(ws)).toHaveLength(1);
    expect(logs).toContain(`[browser-host] register host=${id.hostId} profiles=1 pin=ok`);
  });

  it("a corrupt pin file is treated as empty; the file is rewritten on the next register", async () => {
    writeFileSync(join(dir, "operator-hosts.json"), "{not json");
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    expect(registered(ws)).toHaveLength(1);
    expect(pinFile().pins[id.hostId]).toBeDefined();
  });

  it("the pin file holds keys and timestamps only — no nonce or signature", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    const nonce = ws.json().find((m) => m.nonce)!.nonce as string;
    const raw = readFileSync(join(dir, "operator-hosts.json"), "utf-8");
    expect(raw).not.toContain(nonce);
    expect(existsSync(join(dir, "operator-hosts.json.tmp"))).toBe(false);
  });

  it("works with no pinsPath (in-memory only)", async () => {
    const reg = new OperatorHostRegistry({
      getServerId: () => SERVER_ID,
      audit,
      logger: { info() {}, warn() {}, error() {} },
      onHostGone: () => {},
      hasActivity: () => false,
    });
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    expect(registered(ws)).toHaveLength(1);
  });
});

describe("carrier close", () => {
  it("drops the binding, notifies onHostGone once, host is not listed", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    ws.close(1006, "x");
    expect(gone).toEqual([{ hostId: id.hostId, socket: ws }]);
    expect(reg.get(id.hostId)).toBeUndefined();
    expect(reg.hostOfSocket(ws)).toBeUndefined();
  });

  it("a socket that only said hello (never registered) closing is not a host-gone", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await reg.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, ws);
    ws.close(1000, "x");
    expect(gone).toHaveLength(0);
  });
});

describe("secrets stay out of logs and audit (D11)", () => {
  it("no nonce, signature or public key in any log line or audit entry", async () => {
    const reg = makeRegistry();
    const id = makeIdentity();
    const ws = new FakeSocket();
    await handshake(reg, ws, id);
    const bad = new FakeSocket();
    await handshake(reg, bad, { ...id, hostId: makeIdentity().hostId });
    const nonce = ws.json().find((m) => m.nonce)!.nonce as string;
    const blob = JSON.stringify([logs, audit.list()]);
    expect(blob).not.toContain(nonce);
    expect(blob).not.toContain(id.publicKey);
  });
});
