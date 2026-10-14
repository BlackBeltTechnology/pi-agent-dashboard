/**
 * vault-projects: the remembered-project list behind the vault project picker.
 * Bounds (200 total, 100 per device, 90 days), the 1 h write throttle, input
 * caps, "no file until a valid record", and corrupt-file recovery.
 * Runs under the fresh tmp $HOME per test file.
 * See change: retro-ux-credential-vault (test-plan E1–E6, X7).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import { createVaultProjects } from "../vault/vault-projects.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);

let dir: string;
let file: string;
let clock: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-projects-"));
  file = path.join(dir, "vault-projects.json");
  clock = T0;
  _resetQuarantineDedupForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const mk = () => createVaultProjects({ file, now: () => clock });
const rawEntries = (): Array<{ deviceId: string; dir: string; lastSeenAt: number }> =>
  (JSON.parse(fs.readFileSync(file, "utf-8")) as { projects: Array<{ deviceId: string; dir: string; lastSeenAt: number }> }).projects;
const writeFile = (projects: unknown[]) => fs.writeFileSync(file, JSON.stringify({ projects }), { mode: 0o600 });

describe("vault projects — bounds", () => {
  it("E1: the store holds 200 entries; the 201st evicts the least recently seen", async () => {
    const store = mk();
    for (let i = 0; i < 199; i++) { clock = T0 + i; await store.record({ deviceId: `d${i % 4}x`, dir: `/p/${i}` }); }
    // Spread over 4 devices x 50 so only the global cap matters.
    expect(store.list()).toHaveLength(199);
    clock = T0 + 199;
    await store.record({ deviceId: "d3x", dir: "/p/199" });
    expect(rawEntries()).toHaveLength(200);
    clock = T0 + 200;
    await store.record({ deviceId: "d0x", dir: "/p/200" });
    const keys = rawEntries().map((e) => e.dir);
    expect(keys).toHaveLength(200);
    expect(keys).not.toContain("/p/0");
    expect(keys).toContain("/p/200");
  });

  it("E2: the 101st project of one device evicts that device's oldest only", async () => {
    const store = mk();
    for (let i = 0; i < 100; i++) { clock = T0 + i; await store.record({ deviceId: "hub", dir: `/hub/${i}` }); }
    for (let i = 0; i < 50; i++) { clock = T0 + 1000 + i; await store.record({ deviceId: "mac-mini-iroda", dir: `/mac/${i}` }); }
    clock = T0 + 2000;
    await store.record({ deviceId: "hub", dir: "/hub/100" });
    const all = rawEntries();
    const hub = all.filter((e) => e.deviceId === "hub");
    expect(hub).toHaveLength(100);
    expect(hub.map((e) => e.dir)).not.toContain("/hub/0");
    expect(hub.map((e) => e.dir)).toContain("/hub/100");
    expect(all.filter((e) => e.deviceId === "mac-mini-iroda")).toHaveLength(50);
  });

  it("E3: list() hides entries older than 90 days (89 d and 90 d stay) and never writes", () => {
    writeFile([
      { deviceId: "hub", dir: "/a", lastSeenAt: T0 - 89 * DAY },
      { deviceId: "hub", dir: "/b", lastSeenAt: T0 - 90 * DAY },
      { deviceId: "hub", dir: "/c", lastSeenAt: T0 - 90 * DAY - 1 },
    ]);
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const dirs = mk().list().map((e) => e.dir).sort();
    expect(dirs).toEqual(["/a", "/b"]);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it("expired entries are dropped from the file on the next write", async () => {
    writeFile([{ deviceId: "hub", dir: "/old", lastSeenAt: T0 - 91 * DAY }]);
    await mk().record({ deviceId: "hub", dir: "/new" });
    expect(rawEntries().map((e) => e.dir)).toEqual(["/new"]);
  });
});

describe("vault projects — write throttle", () => {
  it("E4: a known key is rewritten only after 1 h; a new key writes at once", async () => {
    const store = mk();
    const rename = vi.spyOn(fs, "renameSync");
    await store.record({ deviceId: "hub", dir: "/k" });
    expect(rename).toHaveBeenCalledTimes(1);

    clock = T0 + 59 * 60 * 1000;
    await store.record({ deviceId: "hub", dir: "/k" });
    expect(rename).toHaveBeenCalledTimes(1);

    clock = T0 + 61 * 60 * 1000;
    await store.record({ deviceId: "hub", dir: "/k" });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(rawEntries()[0].lastSeenAt).toBe(T0 + 61 * 60 * 1000);

    clock = T0 + 61 * 60 * 1000 + 1000;
    await store.record({ deviceId: "hub", dir: "/l" });
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("a fresh instance (restart) writes a known key once", async () => {
    await mk().record({ deviceId: "hub", dir: "/k" });
    const rename = vi.spyOn(fs, "renameSync");
    const again = mk();
    await again.record({ deviceId: "hub", dir: "/k" });
    await again.record({ deviceId: "hub", dir: "/k" });
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe("vault projects — input caps and file creation", () => {
  it("E5: dir 4096 / repoKey 512 are recorded; 4097 / 513 are not and create no file", async () => {
    const ok = mk();
    await ok.record({ deviceId: "hub", dir: "/".padEnd(4096, "d") });
    expect(rawEntries()).toHaveLength(1);
    fs.rmSync(file);
    await ok.record({ deviceId: "hub", dir: "/r", repoKey: "k".repeat(512) });
    expect(rawEntries()).toHaveLength(1);
    fs.rmSync(file);

    const store = mk();
    await store.record({ deviceId: "hub", dir: "/".padEnd(4097, "d") });
    await store.record({ deviceId: "hub", dir: "/r2", repoKey: "k".repeat(513) });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("E6: list() and an invalid record create no file; a valid record creates 0600, never vault.json", async () => {
    const store = mk();
    expect(store.list()).toEqual([]);
    await store.record({ deviceId: "hub", dir: "/".padEnd(5000, "d") });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, "vault.json"))).toBe(false);

    await store.record({ deviceId: "hub", dir: "/ok", repoKey: "github.com/a/b" });
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, "vault.json"))).toBe(false);
    expect(store.list()).toEqual([{ deviceId: "hub", dir: "/ok", repoKey: "github.com/a/b", lastSeenAt: T0 }]);
  });

  it("record() never throws synchronously, even on garbage input", () => {
    const store = mk();
    expect(() => store.record(null as never)).not.toThrow();
    expect(() => store.record({ deviceId: 7, dir: {} } as never)).not.toThrow();
  });
});

describe("vault projects — corrupt file", () => {
  it("X7: list() → [] with a .corrupt-* copy kept; the next record() replaces the original", async () => {
    fs.writeFileSync(file, "{oops", { mode: 0o600 });
    const store = mk();
    expect(store.list()).toEqual([]);
    const copies = fs.readdirSync(dir).filter((n) => n.startsWith("vault-projects.json.corrupt-"));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, copies[0]), "utf-8")).toBe("{oops");

    await store.record({ deviceId: "hub", dir: "/fresh" });
    expect(rawEntries()).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
  });
});
