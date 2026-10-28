/**
 * plugin-credential-store: namespace isolation, validation caps, copies,
 * read-never-creates, 0600, auth.json invariance, concurrency, and the shared
 * lock/quarantine fault paths (cross-file dedup, EACCES, contention).
 * Runs under the fresh tmp $HOME per test file. Every store is built with a
 * test codec (fixed 32-byte key): no test touches a real keychain.
 * See change: expose-plugin-credential-and-oauth-seams (test-plan E1–E11, P1, X1–X4).
 * See change: encrypt-credentials-at-rest (test-plan E26, E29–E34, X10, P4, ensure-before-lock).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { CredentialKeyFailureReason } from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelopeCodec, decodeEnvelope, encodeEnvelope } from "../auth/credential-envelope.js";
import {
  _resetCredentialKeyForTests,
  getCredentialCodec,
  getCredentialKeyState,
  initCredentialKey,
} from "../auth/credential-key.js";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import {
  createPluginCredentialStore as createStoreWithOptions,
  MAX_RECORD_BYTES,
  PluginCredentialError,
} from "../auth/plugin-credential-store.js";
import { createKeyringSandbox, KEY_1, KEY_2, stubKeychain } from "./helpers/credential-key-kit.js";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

const DIR = path.join(os.homedir(), ".pi", "agent");
const FILE = path.join(DIR, "plugin-credentials.json");
const AUTH = path.join(DIR, "auth.json");
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const MARKER = "tok-Z4mW8qN2xV6c";
const keyedCodec = (key: Buffer) => createEnvelopeCodec("plugin-credentials", () => ({ ok: true, key }));
const noKeyCodec = (reason: CredentialKeyFailureReason = "keychain_unavailable") =>
  createEnvelopeCodec("plugin-credentials", () => ({ ok: false, reason }));
/** The pre-change call shape, over a test codec, so the existing suite keeps its text. */
const createPluginCredentialStore = (pluginId: string, filePath: string = FILE) =>
  createStoreWithOptions(pluginId, { codec: keyedCodec(KEY_1), path: filePath });
const decodeFile = (key: Buffer = KEY_1) => {
  const out = decodeEnvelope(fs.readFileSync(FILE), key, "plugin-credentials");
  if (out.kind !== "document") throw new Error(`file is not a readable envelope: ${out.kind}`);
  return out.doc as Record<string, Record<string, unknown>>;
};
const backups = (base: string) => fs.readdirSync(DIR).filter((f) => f.startsWith(`${base}.corrupt-`));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A record whose JSON serialization is exactly `bytes` long. */
function recordOfBytes(bytes: number): Record<string, unknown> {
  const overhead = JSON.stringify({ p: "" }).length;
  return { p: "x".repeat(bytes - overhead) };
}

beforeEach(() => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  _resetQuarantineDedupForTests();
  _resetCredentialKeyForTests();
});

afterEach(() => {
  try { fs.chmodSync(DIR, 0o700); } catch { /* absent */ }
  vi.restoreAllMocks();
});

describe("plugin credential store — namespace (E1, E2)", () => {
  it("E1: another plugin cannot list or read a key", async () => {
    const gmail = createPluginCredentialStore("gmail", FILE);
    const other = createPluginCredentialStore("other", FILE);
    await gmail.set("a@x.com", { refresh: "r" });
    expect(await other.list()).toEqual([]);
    expect(await other.get("a@x.com")).toBeUndefined();
    expect(await other.snapshot()).toEqual({});
  });

  it("E2: a path-like key stays inside the caller's namespace", async () => {
    const gmail = createPluginCredentialStore("gmail", FILE);
    await gmail.set("../other/x", { v: 1 });
    const data = decodeFile();
    expect(data.gmail["../other/x"]).toEqual({ v: 1 });
    expect(data.other).toBeUndefined();
    expect(Object.keys(data)).toEqual(["gmail"]);
  });
});

describe("plugin credential store — validation (E3–E6)", () => {
  it("E3: key length boundaries and reserved keys", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await expect(s.set("a", { v: 1 })).resolves.toBeUndefined();
    await expect(s.set("k".repeat(200), { v: 1 })).resolves.toBeUndefined();
    for (const bad of ["", "k".repeat(201), "__proto__", "constructor"]) {
      await expect(s.set(bad, { v: 1 })).rejects.toMatchObject({ code: "invalid_key" });
    }
    expect(({} as Record<string, unknown>).v).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("v");
    expect((await s.list()).sort()).toEqual(["a", "k".repeat(200)].sort());
  });

  it("E4: record size 65535 / 65536 accepted, 65537 rejects without changing the file", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("a", recordOfBytes(MAX_RECORD_BYTES - 1));
    await s.set("b", recordOfBytes(MAX_RECORD_BYTES));
    const before = sha(FILE);
    await expect(s.set("c", recordOfBytes(MAX_RECORD_BYTES + 1))).rejects.toMatchObject({ code: "record_too_large" });
    expect(sha(FILE)).toBe(before);
  });

  it("E5: 256 keys accepted, 257th rejects; a write crossing 2 MiB rejects", async () => {
    const s = createPluginCredentialStore("p", FILE);
    const seed: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 255; i++) seed[`k${i}`] = { i };
    fs.writeFileSync(FILE, JSON.stringify({ p: seed }), { mode: 0o600 });
    await expect(s.set("k255", { i: 255 })).resolves.toBeUndefined();
    expect(await s.list()).toHaveLength(256);
    await expect(s.set("k256", { i: 256 })).rejects.toMatchObject({ code: "too_many_keys" });

    const big = createPluginCredentialStore("big", FILE);
    const bulk: Record<string, Record<string, unknown>> = {};
    // 31 × ~64 KiB + filler ≈ 2 MiB − 1 KiB.
    for (let i = 0; i < 31; i++) bulk[`b${i}`] = recordOfBytes(MAX_RECORD_BYTES);
    const used = Buffer.byteLength(JSON.stringify(bulk));
    bulk.fill = recordOfBytes(2 * 1024 * 1024 - 1024 - used - 10);
    fs.writeFileSync(FILE, JSON.stringify({ big: bulk }), { mode: 0o600 });
    await expect(big.set("small", { v: 1 })).resolves.toBeUndefined();
    await expect(big.set("crossing", recordOfBytes(4096))).rejects.toMatchObject({ code: "namespace_too_large" });
  });

  it("E6: non-plain records reject typed and write nothing", async () => {
    const s = createPluginCredentialStore("p", FILE);
    for (const bad of [[], "str", null, new Date()]) {
      await expect(s.set("k", bad as never)).rejects.toBeInstanceOf(PluginCredentialError);
    }
    expect(fs.existsSync(FILE)).toBe(false);
  });
});

describe("plugin credential store — reads (E7–E9)", () => {
  it("E7: get/snapshot return copies", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("k", { a: 1 });
    const got = (await s.get("k"))!;
    got.a = 2;
    const snap = await s.snapshot();
    snap.k.a = 3;
    expect(await s.get("k")).toEqual({ a: 1 });
  });

  it("E8: list returns keys only", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("x", { refresh: "secret-1" });
    await s.set("y", { refresh: "secret-2" });
    const keys = await s.list();
    expect(keys.sort()).toEqual(["x", "y"]);
    expect(JSON.stringify(keys)).not.toContain("secret");
  });

  it("E9: reads never create the file", async () => {
    const s = createPluginCredentialStore("p", FILE);
    expect(await s.get("k")).toBeUndefined();
    expect(await s.list()).toEqual([]);
    expect(await s.snapshot()).toEqual({});
    expect(fs.existsSync(FILE)).toBe(false);
  });
});

describe("plugin credential store — writes (E10, E11, P1)", () => {
  it.skipIf(process.platform === "win32")("E10: first set creates the file 0600", async () => {
    await createPluginCredentialStore("p", FILE).set("k", { v: 1 });
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
  });

  it("E11: auth.json bytes are untouched by store writes", async () => {
    fs.writeFileSync(AUTH, JSON.stringify({ anthropic: { type: "api_key", key: "fixture" } }), { mode: 0o600 });
    const before = sha(AUTH);
    const s = createPluginCredentialStore("p", FILE);
    for (let i = 0; i < 10; i++) {
      await s.set(`k${i}`, { i });
      await s.update(`k${i}`, (prev) => ({ ...prev, u: true }));
      await s.remove(`k${i}`);
    }
    expect(sha(AUTH)).toBe(before);
  });

  it("update keeps concurrent field changes on one key", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("k", {});
    await Promise.all([
      s.update("k", (prev) => ({ ...prev, a: 1 })),
      s.update("k", (prev) => ({ ...prev, b: 2 })),
    ]);
    expect(await s.get("k")).toEqual({ a: 1, b: 2 });
  });

  it("update returning undefined deletes", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("k", { v: 1 });
    await s.update("k", () => undefined);
    expect(await s.list()).toEqual([]);
  });

  it("P1: 20 concurrent updates all land within the lock budget", async () => {
    const s = createPluginCredentialStore("p", FILE);
    const started = Date.now();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        s.update("counter", (prev) => ({ n: ((prev?.n as number | undefined) ?? 0) + 1 })),
      ),
    );
    expect(await s.get("counter")).toEqual({ n: 20 });
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);
});

describe("plugin credential store — fault injection (X1–X4)", () => {
  it("X1: identical corrupt bytes in auth.json and the store each get their own backup", async () => {
    const bytes = Buffer.from('{"a":');
    fs.writeFileSync(AUTH, bytes);
    fs.writeFileSync(FILE, bytes);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const storage = await import("../auth/provider-auth-storage.js");
    await storage.writeCredential("x1", { type: "api_key", key: "k" });
    await createPluginCredentialStore("p", FILE).set("k", { v: 1 });
    const a = backups("auth.json");
    const p = backups("plugin-credentials.json");
    expect(a).toHaveLength(1);
    expect(p).toHaveLength(1);
    expect(fs.readFileSync(path.join(DIR, a[0]))).toEqual(bytes);
    expect(fs.readFileSync(path.join(DIR, p[0]))).toEqual(bytes);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "X2: a corrupt file that cannot be backed up is never overwritten",
    async () => {
      const bytes = Buffer.from('{"a":');
      fs.writeFileSync(FILE, bytes);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const realWrite = fs.writeFileSync;
      vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        if (String(p).includes(".corrupt-")) {
          throw Object.assign(new Error("EROFS: read-only"), { code: "EROFS" });
        }
        return (realWrite as (...a: unknown[]) => void)(p, ...rest);
      }) as typeof fs.writeFileSync);
      await expect(createPluginCredentialStore("p", FILE).set("k", { v: 1 })).rejects.toThrow(/could not be backed up/);
      expect(fs.readFileSync(FILE)).toEqual(bytes);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "X3: a lock permission error rejects immediately, unretried",
    async () => {
      const s = createPluginCredentialStore("p", FILE);
      await s.set("k", { v: 1 });
      fs.chmodSync(DIR, 0o500);
      const started = Date.now();
      const err = await s.set("k", { v: 2 }).then(() => null, (e: { code?: string }) => e);
      fs.chmodSync(DIR, 0o700);
      expect(err?.code).toBe("EACCES");
      expect(Date.now() - started).toBeLessThan(100);
    },
  );

  it("X4: contention waits for a short hold and rejects ELOCKED after ~2 s", async () => {
    const s = createPluginCredentialStore("p", FILE);
    await s.set("k", { v: 1 });
    const opts = { stale: 10_000, realpath: false } as const;

    const r1 = await lockfile.lock(FILE, opts);
    setTimeout(() => { r1().catch(() => {}); }, 500);
    await expect(s.set("k", { v: 2 })).resolves.toBeUndefined();
    expect(await s.get("k")).toEqual({ v: 2 });

    const r2 = await lockfile.lock(FILE, opts);
    const started = Date.now();
    try {
      await expect(s.set("k", { v: 3 })).rejects.toMatchObject({ code: "ELOCKED" });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThan(1_500);
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      await r2();
    }
    await sleep(0);
  }, 10_000);
});

// ── encrypt-credentials-at-rest ───────────────────────────────────────

const snap = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const asLocked = (e: unknown) => e as PluginCredentialError & { reason?: string };

describe("plugin credential store — codec required (E26)", () => {
  it("E26: codec required — a store without a codec throws before touching the file", async () => {
    // @ts-expect-error the options object must carry a codec
    expect(() => createStoreWithOptions("p", {})).toThrow(/codec/i);
    // @ts-expect-error the pre-change `path` string form is gone
    expect(() => createStoreWithOptions("p", FILE)).toThrow(/codec/i);
    expect(fs.existsSync(FILE)).toBe(false);
  });
});

describe("plugin credential store — encrypted at rest (E29, E31)", () => {
  it("E29: plugin API unchanged — same results as before, file is an envelope after each write", async () => {
    const s = createPluginCredentialStore("p");
    const isEnvelope = () => fs.readFileSync(FILE, "utf8").startsWith("pi-dashboard-encrypted:v1\n");
    await s.set("a@x.com", { token: MARKER });
    expect(isEnvelope()).toBe(true);
    expect(await s.get("a@x.com")).toEqual({ token: MARKER });
    expect(await s.list()).toEqual(["a@x.com"]);
    expect(await s.snapshot()).toEqual({ "a@x.com": { token: MARKER } });
    expect(await s.update("a@x.com", (prev) => ({ ...prev, n: 1 }))).toEqual({ token: MARKER, n: 1 });
    expect(isEnvelope()).toBe(true);
    expect(await s.get("a@x.com")).toEqual({ token: MARKER, n: 1 });
    await s.remove("a@x.com");
    expect(await s.list()).toEqual([]);
    expect(await s.get("a@x.com")).toBeUndefined();
    expect(isEnvelope()).toBe(true);
  });

  it("round trip: the raw file does not hold the secret; decrypting yields the namespace", async () => {
    await createPluginCredentialStore("p").set("a@x.com", { token: MARKER });
    expect(fs.readFileSync(FILE, "utf8")).not.toContain(MARKER);
    expect(fs.readFileSync(FILE, "utf8")).not.toContain("a@x.com");
    expect(decodeFile()).toEqual({ p: { "a@x.com": { token: MARKER } } });
  });

  it.skipIf(process.platform === "win32")("E31: 0600 envelope on create", async () => {
    await createPluginCredentialStore("p").set("k", { token: MARKER });
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(FILE, "utf8").split("\n")[0]).toBe("pi-dashboard-encrypted:v1");
    expect(decodeFile().p).toEqual({ k: { token: MARKER } });
  });

  it("a plaintext file is read as-is and encrypted by the next write", async () => {
    fs.writeFileSync(FILE, JSON.stringify({ p: { k: { token: MARKER } } }), { mode: 0o600 });
    const s = createPluginCredentialStore("p");
    expect(await s.get("k")).toEqual({ token: MARKER });
    await s.set("k2", { v: 1 });
    expect(fs.readFileSync(FILE, "utf8")).not.toContain(MARKER);
    expect(decodeFile().p).toEqual({ k: { token: MARKER }, k2: { v: 1 } });
  });
});

describe("plugin credential store — locked (E30, E33, E34, X10)", () => {
  const seedEnvelope = (key: Buffer = KEY_2) => {
    fs.writeFileSync(FILE, encodeEnvelope({ p: { k: { token: MARKER } } }, key, "plugin-credentials"), { mode: 0o600 });
  };

  it("E30: a store locked by a different key rejects every operation with store_locked/key_mismatch", async () => {
    seedEnvelope(KEY_2);
    const before = snap(FILE);
    const s = createPluginCredentialStore("p");
    const ops: Array<[string, () => Promise<unknown>]> = [
      ["get", () => s.get("k")],
      ["list", () => s.list()],
      ["snapshot", () => s.snapshot()],
      ["set", () => s.set("k", { v: 1 })],
      ["update", () => s.update("k", (prev) => ({ ...prev, v: 1 }))],
      ["remove", () => s.remove("k")],
    ];
    for (const [name, op] of ops) {
      const err = await op().then(() => null, (e: unknown) => e);
      expect(err, name).toBeInstanceOf(PluginCredentialError);
      expect(asLocked(err).code, name).toBe("store_locked");
      expect(asLocked(err).reason, name).toBe("key_mismatch");
      expect(JSON.stringify(err), name).not.toContain(MARKER);
      expect(String((err as Error).message), name).not.toContain(MARKER);
    }
    expect(snap(FILE)).toBe(before);
    expect(backups("plugin-credentials.json")).toHaveLength(0);
  });

  it("E33: a damaged envelope is not corrupt — store_locked/envelope_damaged, no backup, bytes unchanged", async () => {
    fs.writeFileSync(FILE, "pi-dashboard-encrypted:v1\n{\"alg\":\"A256GCM\",\"kid\":", { mode: 0o600 });
    const before = snap(FILE);
    const s = createPluginCredentialStore("p");
    const err = await s.set("k", { v: 1 }).then(() => null, (e: unknown) => e);
    expect(asLocked(err)).toBeInstanceOf(PluginCredentialError);
    expect(asLocked(err).code).toBe("store_locked");
    expect(asLocked(err).reason).toBe("envelope_damaged");
    expect(await s.get("k").then(() => null, (e: unknown) => asLocked(e).reason)).toBe("envelope_damaged");
    expect(backups("plugin-credentials.json")).toHaveLength(0);
    expect(snap(FILE)).toBe(before);
  });

  it("E34: plaintext is readable without a key; set rejects store_locked naming PI_DASHBOARD_DATA_KEY_FILE", async () => {
    fs.writeFileSync(FILE, JSON.stringify({ p: { k: { token: MARKER } } }), { mode: 0o600 });
    const before = snap(FILE);
    const s = createStoreWithOptions("p", { codec: noKeyCodec("keychain_unavailable"), path: FILE });
    expect(await s.get("k")).toEqual({ token: MARKER });
    const err = await s.set("k2", { v: 1 }).then(() => null, (e: unknown) => e);
    expect(asLocked(err)).toBeInstanceOf(PluginCredentialError);
    expect(asLocked(err).code).toBe("store_locked");
    expect(asLocked(err).reason).toBe("keychain_unavailable");
    expect((err as Error).message).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    expect(snap(FILE)).toBe(before);
    expect(backups("plugin-credentials.json")).toHaveLength(0);
  });

  it("X10: wrong key keeps the ciphertext — set refused, bytes unchanged, 0 backups", async () => {
    seedEnvelope(KEY_2);
    const before = snap(FILE);
    await expect(createPluginCredentialStore("p").set("k", { v: 1 })).rejects.toMatchObject({
      code: "store_locked",
      reason: "key_mismatch",
    });
    expect(snap(FILE)).toBe(before);
    expect(backups("plugin-credentials.json")).toHaveLength(0);
    expect(fs.existsSync(`${FILE}.tmp`)).toBe(false);
  });

  it("an envelope with no key available rejects reads and writes with the key reason, untouched", async () => {
    seedEnvelope(KEY_1);
    const before = snap(FILE);
    const s = createStoreWithOptions("p", { codec: noKeyCodec("key_missing"), path: FILE });
    await expect(s.get("k")).rejects.toMatchObject({ code: "store_locked", reason: "key_missing" });
    await expect(s.set("k", { v: 1 })).rejects.toMatchObject({ code: "store_locked", reason: "key_missing" });
    expect(snap(FILE)).toBe(before);
  });
});

describe("plugin credential store — corrupt plaintext (E32)", () => {
  it.skipIf(process.platform === "win32")(
    "E32: corrupt plaintext still quarantined — own byte-exact 0600 backup; store becomes an envelope; auth.json stays plain JSON",
    async () => {
      const bytes = Buffer.from("{not json");
      fs.writeFileSync(AUTH, bytes);
      fs.writeFileSync(FILE, bytes);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.resetModules();
      const storage = await import("../auth/provider-auth-storage.js");
      await storage.writeCredential("e32", { type: "api_key", key: "k" });
      await createPluginCredentialStore("p").set("k", { v: 1 });
      const a = backups("auth.json");
      const p = backups("plugin-credentials.json");
      expect(a).toHaveLength(1);
      expect(p).toHaveLength(1);
      expect(fs.readFileSync(path.join(DIR, p[0]))).toEqual(bytes);
      expect(fs.readFileSync(path.join(DIR, a[0]))).toEqual(bytes);
      expect(fs.statSync(path.join(DIR, p[0])).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(FILE, "utf8").startsWith("pi-dashboard-encrypted:v1\n")).toBe(true);
      expect(decodeFile().p).toEqual({ k: { v: 1 } });
      expect(() => JSON.parse(fs.readFileSync(AUTH, "utf8"))).not.toThrow();
    },
  );
});

describe("plugin credential store — readiness before the lock (D4)", () => {
  const lockfile2 = _require("proper-lockfile") as typeof import("proper-lockfile");

  it("a write with no key available is refused before the store lock is taken", async () => {
    fs.writeFileSync(FILE, JSON.stringify({ p: { k: { v: 0 } } }), { mode: 0o600 });
    const s = createStoreWithOptions("p", { codec: noKeyCodec("keychain_timeout"), path: FILE });
    const release = await lockfile2.lock(FILE, { stale: 10_000, realpath: false });
    try {
      const started = Date.now();
      await expect(s.set("k", { v: 1 })).rejects.toMatchObject({ code: "store_locked", reason: "keychain_timeout" });
      expect(Date.now() - started).toBeLessThan(500); // never waited on the held lock
    } finally {
      await release();
    }
  });

  it("the first write while the key is deferred resolves (creates) the key, then writes an envelope", async () => {
    const kc = stubKeychain(null);
    const lines: string[] = [];
    const st = await initCredentialKey({ entryFactory: kc.factory, homeDir: os.homedir(), log: (l) => lines.push(l) });
    expect(st.state).toBe("deferred");
    expect(kc.calls.get + kc.calls.set).toBe(0);
    const s = createStoreWithOptions("p", { codec: getCredentialCodec("plugin-credentials"), path: FILE });
    expect(await s.list()).toEqual([]); // reads never resolve the key
    expect(kc.calls.get + kc.calls.set).toBe(0);
    await s.set("k", { token: MARKER });
    expect(getCredentialKeyState().state).toBe("ready");
    expect(kc.calls.set).toBe(1);
    expect(fs.readFileSync(FILE, "utf8").startsWith("pi-dashboard-encrypted:v1\n")).toBe(true);
    expect(await s.get("k")).toEqual({ token: MARKER });
    expect(lines.join("\n")).not.toContain(MARKER);
  });

  it("a store over the singleton codec before init refuses writes with key_uninitialized", async () => {
    const s = createStoreWithOptions("p", { codec: getCredentialCodec("plugin-credentials"), path: FILE });
    await expect(s.set("k", { v: 1 })).rejects.toMatchObject({ code: "store_locked", reason: "key_uninitialized" });
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("a transient creation-lock refusal reports keychain_unavailable and is not cached", async () => {
    const sandbox = createKeyringSandbox();
    try {
      const kc = stubKeychain(null);
      await initCredentialKey({ entryFactory: kc.factory, homeDir: os.homedir(), log: () => {} });
      const creationLock = path.join(os.homedir(), ".pi", "dashboard", "credential-key");
      fs.mkdirSync(path.dirname(creationLock), { recursive: true });
      fs.writeFileSync(creationLock, "");
      const release = await lockfile2.lock(creationLock, { stale: 30_000, realpath: false });
      const s = createStoreWithOptions("p", { codec: getCredentialCodec("plugin-credentials"), path: FILE });
      await expect(s.set("k", { v: 1 })).rejects.toMatchObject({ code: "store_locked", reason: "keychain_unavailable" });
      expect(getCredentialKeyState().state).toBe("deferred");
      await release();
      await s.set("k", { v: 1 });
      expect(getCredentialKeyState().state).toBe("ready");
    } finally {
      sandbox.cleanup();
    }
  }, 15_000);
});

describe("plugin credential store — decrypt-on-read cost (P4)", () => {
  it("P4: p95 of decode+parse per get on a 2 MiB envelope is under 50 ms", async () => {
    const s = createPluginCredentialStore("big");
    const bulk: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 31; i++) bulk[`b${i}`] = recordOfBytes(MAX_RECORD_BYTES);
    const used = Buffer.byteLength(JSON.stringify(bulk));
    bulk.fill = recordOfBytes(2 * 1024 * 1024 - 1024 - used - 10);
    fs.writeFileSync(FILE, encodeEnvelope({ big: bulk }, KEY_1, "plugin-credentials"), { mode: 0o600 });
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      await s.get("b0");
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);
  }, 30_000);
});
