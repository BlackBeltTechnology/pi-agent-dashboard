/**
 * Corrupt-content recovery for auth.json (test-plan E1–E17, X2–X4) and the
 * write-path refusal that guards the same bytes (test-plan E11–E15).
 *
 * The suite runs under a fresh tmp $HOME per test file
 * (setup-home-perfile.ts), so these tests write `auth.json` directly —
 * no save/restore of a real credential file is needed or wanted here.
 *
 * See change: fix-corrupt-auth-json-500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { userInfo, homedir } from "node:os";

const authDir = path.join(homedir(), ".pi", "agent");
const authPath = path.join(authDir, "auth.json");

function writeAuthFile(content: string): void {
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(authPath, content);
}

function authFileBytes(): Buffer {
  return fs.readFileSync(authPath);
}

/** All quarantine files currently in the auth dir (fresh HOME per file ⇒ only ours). */
function quarantineFiles(): string[] {
  try {
    return fs.readdirSync(authDir).filter((f) => f.startsWith("auth.json.corrupt-"));
  } catch {
    return [];
  }
}

function quarantinePath(name: string): string {
  return path.join(authDir, name);
}

async function storage() {
  return await import("../auth/provider-auth-storage.js");
}

describe("readAuthJson — corrupt-content recovery", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    (await storage())._resetQuarantineDedupForTests();
    try { fs.rmSync(authPath, { force: true }); } catch { /* absent */ }
    for (const f of quarantineFiles()) fs.rmSync(quarantinePath(f), { force: true });
  });

  it("placeholder guard: tmp HOME isolation is active", () => {
    // Tripwire mirroring the globalSetup one: if this fires, the corrupt tests
    // below would be touching the developer's real credential file.
    expect(homedir()).not.toBe(userInfo().homedir);
  });

  // #E1 — zero bytes is corrupt content, read tolerates, file untouched.
  it("empty file yields an empty credential set and is left byte-identical on disk", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile("");
    expect(readAuthJson()).toEqual({});
    expect(authFileBytes().toString()).toBe("");
    expect(quarantineFiles()).toHaveLength(1);
  });

  // #E2 — truncated JSON quarantined byte-exactly.
  it("truncated JSON is quarantined byte-exactly", async () => {
    const { readAuthJson } = await storage();
    const corrupt = '{"anthropic":{"type":"oauth","refr';
    writeAuthFile(corrupt);
    expect(readAuthJson()).toEqual({});
    const files = quarantineFiles();
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(quarantinePath(files[0]), "utf-8")).toBe(corrupt);
  });

  // #E3 — valid JSON of the wrong shape is corrupt: null, [], 42.
  it.each([["null"], ["[]"], ["42"]])("non-object JSON body %s is corrupt, not fatal", async (body) => {
    const { readAuthJson } = await storage();
    writeAuthFile(body);
    expect(readAuthJson()).toEqual({});
    expect(quarantineFiles()).toHaveLength(1);
  });

  // #E4 — legitimately empty object is NOT corrupt.
  it("empty object is not corrupt: no quarantine file, no log line", async () => {
    const { readAuthJson } = await storage();
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    writeAuthFile("{}");
    expect(readAuthJson()).toEqual({});
    expect(quarantineFiles()).toHaveLength(0);
    for (const spy of [warn, error, log]) {
      expect(spy.mock.calls.some((c) => c.join(" ").includes("corrupt"))).toBe(false);
    }
  });

  // #E5 — BOM-prefixed valid JSON parses fine.
  it("BOM-prefixed valid JSON is not corrupt", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('\uFEFF{"openai":{"type":"api_key","key":"sk-x"}}');
    const data = readAuthJson();
    expect(data["openai"]).toEqual({ type: "api_key", key: "sk-x" });
    expect(quarantineFiles()).toHaveLength(0);
  });

  // #E6 — missing file is not a corruption: no quarantine, no log.
  it("missing file returns empty with no quarantine and no quarantine log", async () => {
    const { readAuthJson } = await storage();
    const warn = vi.spyOn(console, "warn");
    try { fs.rmSync(authPath, { force: true }); } catch { /* absent */ }
    expect(readAuthJson()).toEqual({});
    expect(quarantineFiles()).toHaveLength(0);
    expect(warn.mock.calls.some((c) => c.join(" ").includes("quarantine"))).toBe(false);
  });

  // #E7 — filename is platform-safe: auth.json.corrupt-<YYYYMMDDTHHMMSSsssZ>(-N)?, no colon.
  it("quarantine filename matches the colon-free stamp pattern", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile("garbage");
    readAuthJson();
    const files = quarantineFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^auth\.json\.corrupt-\d{8}T\d{9}Z(-\d+)?$/);
    expect(files[0]).not.toContain(":");
  });

  // #E8 — a pre-existing file at the computed quarantine name is never overwritten.
  it("existing backup gets a -1 suffix instead of being overwritten", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-29T09:38:12.345Z") });
    try {
      const { readAuthJson } = await storage();
      const corrupt = '{"truncated';
      // The name this very call would compute (same clock).
      const expected = `auth.json.corrupt-20260829T093812345Z`;
      writeAuthFile(corrupt);
      fs.writeFileSync(quarantinePath(expected), "PRIOR");

      readAuthJson();

      expect(fs.readFileSync(quarantinePath(expected), "utf-8")).toBe("PRIOR");
      expect(fs.readFileSync(quarantinePath(`${expected}-1`), "utf-8")).toBe(corrupt);
    } finally {
      vi.useRealTimers();
    }
  });

  // #E9 — dedup identity is the content hash, not (size, mtimeMs).
  it("different corrupt bytes sharing size+mtime quarantine separately", async () => {
    const { readAuthJson } = await storage();
    const a = '{"aaaaaaaaaa'; // truncated JSON, 12 bytes
    const b = '{"bbbbbbbbbb'; // same length, different bytes, also corrupt
    const when = new Date("2026-01-01T00:00:00Z");

    writeAuthFile(a);
    fs.utimesSync(authPath, when, when);
    readAuthJson();

    writeAuthFile(b);
    fs.utimesSync(authPath, when, when); // identical stat to A's read
    readAuthJson();

    const files = quarantineFiles();
    expect(files).toHaveLength(2);
    const contents = files.map((f) => fs.readFileSync(quarantinePath(f), "utf-8")).sort();
    expect(contents).toEqual([a, b].sort());
  });

  // #E10 — repeated reads of identical bytes quarantine once.
  it("identical corrupt bytes read 5x create exactly one quarantine copy", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('{"dup":');
    for (let i = 0; i < 5; i++) readAuthJson();
    expect(quarantineFiles()).toHaveLength(1);
  });

  // #E16 — quarantine copy carries mode 0600.
  it("quarantine file mode is 0600", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('{"openai":{"type":"api_key","key":"sk-x"');
    readAuthJson();
    const [f] = quarantineFiles();
    expect(f).toBeDefined();
    expect(fs.statSync(quarantinePath(f)).mode & 0o777).toBe(0o600);
  });

  // #E17 — a failed quarantine copy is retried on the next read, not latched.
  it("failed quarantine copy is retried by the next read", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('{"retry":');
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
    });
    expect(readAuthJson()).toEqual({});
    expect(quarantineFiles()).toHaveLength(0);
    expect(readAuthJson()).toEqual({});
    expect(quarantineFiles()).toHaveLength(1);
  });

  // #X2 — an unreadable file is NOT corrupt: the read must stay loud.
  it("readFileSync failure (EACCES) still throws and quarantines nothing", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('{"secret":true}');
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
    });
    expect(() => readAuthJson()).toThrow();
    expect(quarantineFiles()).toHaveLength(0);
  });

  // #X3 — read-path quarantine failure is swallowed (logged, not thrown).
  it("quarantine copy failure on the read path returns {} without throwing", async () => {
    const { readAuthJson } = await storage();
    writeAuthFile('{"nospace":');
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
    });
    expect(readAuthJson()).toEqual({});
  });

  // #X4 — neither the log line nor the backup filename may carry credential material.
  it("no secret leaks into the log line or the quarantine filename", async () => {
    const { readAuthJson } = await storage();
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => { logs.push(args.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args) => { logs.push(args.join(" ")); });
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    writeAuthFile('{"anthropic":{"type":"oauth","access":"sk-SECRET123"');
    readAuthJson();
    const files = quarantineFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("sk-SECRET123");
    const joined = logs.join("\n");
    expect(joined).not.toContain("sk-SECRET123");
    expect(joined).toContain("auth.json.corrupt-");
  });
});

describe("credential writes refuse to clobber un-backed-up bytes", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    (await storage())._resetQuarantineDedupForTests();
    try { fs.rmSync(authPath, { force: true }); } catch { /* absent */ }
    for (const f of quarantineFiles()) fs.rmSync(quarantinePath(f), { force: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #E11 — the only path allowed to destroy the bytes is the only path that
  // must refuse when no backup could be made.
  it("writeCredential throws and persists nothing when the backup fails", async () => {
    const { writeCredential } = await storage();
    const corrupt = '{"anthropic":{"type":"oauth","refr';
    writeAuthFile(corrupt);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
    });
    expect(() =>
      writeCredential("openai", { type: "api_key", key: "sk-new" }),
    ).toThrow(/corrupt|backed up/i);
    expect(authFileBytes().toString()).toBe(corrupt);
    expect(quarantineFiles()).toHaveLength(0);
  });

  // #E12 — with the backup in place the write proceeds on {}.
  it("writeCredential proceeds when the backup exists, old bytes survive in quarantine", async () => {
    const { writeCredential, readAuthJson } = await storage();
    const corrupt = "CORRUPT-BYTES-123";
    writeAuthFile(corrupt);
    // The corrupt file is world-readable; the repaired credential file must
    // not inherit those bits.
    fs.chmodSync(authPath, 0o644);
    writeCredential("openai", { type: "api_key", key: "sk-new" });
    expect(readAuthJson()).toEqual({
      openai: { type: "api_key", key: "sk-new" },
    });
    const files = quarantineFiles();
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(quarantinePath(files[0]), "utf-8")).toBe(corrupt);
    // Repair forces 0600 even though the corrupt source was 0644.
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
  });

  // #E13 — a dedup hit counts as backed up: the repair flow must not deadlock.
  it("writeCredential succeeds after a prior read already quarantined the bytes", async () => {
    const { readAuthJson, writeCredential } = await storage();
    writeAuthFile('{"deadlock":');
    expect(readAuthJson()).toEqual({}); // mount-time read quarantines + records the hash
    expect(() =>
      writeCredential("openai", { type: "api_key", key: "sk-repair" }),
    ).not.toThrow();
    const { readAuthJson: reread } = await storage();
    expect(reread()["openai"]).toEqual({ type: "api_key", key: "sk-repair" });
  });

  // #E14 — healthy-path merge semantics are untouched.
  it("writeCredential merges into a valid file without clobbering other providers", async () => {
    const { writeCredential, readAuthJson } = await storage();
    writeAuthFile('{"anthropic":{"type":"oauth","refresh":"r","access":"a","expires":1}}');
    writeCredential("openai", { type: "api_key", key: "sk-new" });
    const data = readAuthJson();
    expect(data["openai"]).toEqual({ type: "api_key", key: "sk-new" });
    expect(data["anthropic"]).toEqual({ type: "oauth", refresh: "r", access: "a", expires: 1 });
    expect(quarantineFiles()).toHaveLength(0);
  });

  // #E15 — the lock helper's placeholder create is 0600, and the write keeps it.
  it("a locked op on a missing auth.json leaves the file at mode 0600", async () => {
    const { writeCredential } = await storage();
    try { fs.rmSync(authPath, { force: true }); } catch { /* absent */ }
    writeCredential("openai", { type: "api_key", key: "sk-mode" });
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
  });

  // CodeRabbit Y5NU — a legacy world-readable file normalizes to owner-only
  // on the next healthy write instead of being preserved forever.
  it("a healthy write normalizes a 0644 auth.json to 0600", async () => {
    const { writeCredential } = await storage();
    writeAuthFile('{"anthropic":{"type":"oauth","refresh":"r","access":"a","expires":1}}');
    fs.chmodSync(authPath, 0o644);
    writeCredential("openai", { type: "api_key", key: "sk-norm" });
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
  });

  // CodeRabbit Y5NZ — writeFileSync's mode applies only at creation, so a
  // stale permissive auth.json.tmp must be chmod'ed before the rename.
  it("a stale world-readable auth.json.tmp does not leak into the renamed file", async () => {
    const { writeCredential } = await storage();
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "auth.json.tmp"), "stale");
    fs.chmodSync(path.join(authDir, "auth.json.tmp"), 0o644);
    writeCredential("openai", { type: "api_key", key: "sk-tmp" });
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
    try { fs.rmSync(path.join(authDir, "auth.json.tmp"), { force: true }); } catch { /* gone */ }
  });
});
