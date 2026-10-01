/**
 * plugin-credential-store: namespace isolation, validation caps, copies,
 * read-never-creates, 0600, auth.json invariance, concurrency, and the shared
 * lock/quarantine fault paths (cross-file dedup, EACCES, contention).
 * Runs under the fresh tmp $HOME per test file.
 * See change: expose-plugin-credential-and-oauth-seams (test-plan E1–E11, P1, X1–X4).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import {
  createPluginCredentialStore,
  MAX_RECORD_BYTES,
  PluginCredentialError,
} from "../auth/plugin-credential-store.js";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

const DIR = path.join(os.homedir(), ".pi", "agent");
const FILE = path.join(DIR, "plugin-credentials.json");
const AUTH = path.join(DIR, "auth.json");
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
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
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
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
  const backups = (base: string) =>
    fs.readdirSync(DIR).filter((f) => f.startsWith(`${base}.corrupt-`));

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
