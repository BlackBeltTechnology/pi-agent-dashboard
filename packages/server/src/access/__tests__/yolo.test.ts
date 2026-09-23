import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HeldAccessPlane } from "../access-plane.js";
import { createCorsPlane, createCwdPlane, createFilesystemPlane, createNetworkPlane } from "../planes.js";
import { __resetRefusalLedger, clearRefusal, isRefused, listRefusals, recordRefusal } from "../refusal-ledger.js";
import { parseYoloEnv } from "../yolo-env.js";
import { YOLO_DURATIONS_MS, YoloController } from "../yolo-session.js";

/**
 * YOLO (change: add-access-grant-dialog, tasks 2b.8, 2b.9, 8b.2-8b.6a, 8b.8;
 * test-plan #E30, #E31, #E33-#E41, #X7, #X10).
 */

let tmp: string;
let clock: number;
let mode: "enforce" | "report";
const MIN = 60_000;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-yolo-")));
  clock = 1_000_000;
  mode = "enforce";
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "access-refusals.json");
  __resetRefusalLedger();
});

afterEach(() => {
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetRefusalLedger();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const mk = (...segs: string[]) => {
  const p = path.join(tmp, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return fs.realpathSync(p);
};

const yolo = () =>
  new YoloController({
    now: () => clock,
    hostGateMode: () => mode,
    isRefused,
    ladder: async () => [],
    onLog: () => {},
  });

const fsPlane = createFilesystemPlane();
const ask = (y: YoloController, subject: string, over: Partial<{ cap: boolean; plane: HeldAccessPlane }> = {}) =>
  y.decide({ plane: over.plane ?? fsPlane, subject, requestHoldsCapability: over.cap ?? true, hostGateMode: mode });

describe("2b.8 / #E41 PI_DASHBOARD_GRANT_YOLO syntax", () => {
  it("accepts one absolute path, a JSON array of absolute paths, and 'unscoped'", () => {
    expect(parseYoloEnv("/repo")).toEqual({ kind: "scoped", roots: ["/repo"] });
    expect(parseYoloEnv('["/repo","/scratch","/repo"]')).toEqual({ kind: "scoped", roots: ["/repo", "/scratch"] });
    expect(parseYoloEnv("unscoped")).toEqual({ kind: "unscoped" });
    expect(parseYoloEnv(undefined)).toEqual({ kind: "unset" });
    expect(parseYoloEnv("  ")).toEqual({ kind: "unset" });
  });

  it("a path containing ':' or ';' is expressible through the JSON form", () => {
    expect(parseYoloEnv('["/data/a:b","/data/c;d"]')).toEqual({ kind: "scoped", roots: ["/data/a:b", "/data/c;d"] });
  });

  it("anything else is unparseable, never a partial or unscoped session", () => {
    for (const bad of ["1", "true", "relative/dir", "[]", "[1]", '["relative"]', "[not json", '{"a":1}', "UNSCOPED"]) {
      expect(parseYoloEnv(bad).kind).toBe("invalid");
    }
  });
});

describe("2b.9 the remembered-refusal ledger is durable and clearable", () => {
  it("#E37 a refusal survives a restart", () => {
    recordRefusal("filesystem", "/repo/.env", 5);
    __resetRefusalLedger(); // simulate a restart: force a disk read
    expect(isRefused("filesystem", "/repo/.env")).toBe(true);
    expect(listRefusals()).toEqual([{ plane: "filesystem", subject: "/repo/.env", refusedAt: 5 }]);
  });

  it("#E37b clearing it on the Access surface removes it", () => {
    recordRefusal("filesystem", "/repo/.env");
    expect(clearRefusal("filesystem", "/repo/.env")).toBe(true);
    __resetRefusalLedger();
    expect(isRefused("filesystem", "/repo/.env")).toBe(false);
    expect(clearRefusal("filesystem", "/repo/.env")).toBe(false);
  });

  it("is keyed by plane, and a malformed store reads as empty", () => {
    recordRefusal("cwd", "/a");
    expect(isRefused("filesystem", "/a")).toBe(false);
    fs.writeFileSync(path.join(tmp, "access-refusals.json"), "{not json");
    __resetRefusalLedger();
    expect(listRefusals()).toEqual([]);
  });

  it("is keyed on the real path: a symlink alias of a refused dir is refused too", () => {
    const real = path.join(fs.realpathSync(tmp), "a");
    fs.mkdirSync(real);
    const alias = path.join(tmp, "lnk");
    fs.symlinkSync(real, alias);
    recordRefusal("cwd", real);
    expect(isRefused("cwd", alias)).toBe(true);
  });

  it("a refusal that fails to reach disk is still honoured in-process", () => {
    const blocker = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocker, "");
    process.env.PI_ACCESS_REFUSALS_STORE = path.join(blocker, "access-refusals.json");
    __resetRefusalLedger();
    expect(recordRefusal("filesystem", "/x/y").ok).toBe(false);
    expect(isRefused("filesystem", "/x/y")).toBe(true);
  });
});

describe("8b.2 session lifetime: fixed at activation, never renewed", () => {
  it("#E30 active until the chosen duration, then inactive", async () => {
    const y = yolo();
    const repo = mk("repo");
    const r = await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(r.ok).toBe(true);
    clock += 15 * MIN - 1_000;
    expect(ask(y, repo)).toBe("auto-allow");
    clock += 2_000;
    expect(ask(y, repo)).toBeNull();
    expect(y.status()).toBeNull();
  });

  it("#E31 continuous auto-allows do not extend it", async () => {
    const y = yolo();
    const repo = mk("repo");
    await y.activate({ durationMs: 15 * MIN, base: repo });
    for (let i = 0; i < 14; i++) {
      clock += MIN;
      ask(y, repo);
    }
    clock += MIN;
    expect(y.status()).toBeNull();
  });

  it("only 15, 30 or 60 minutes can be chosen", async () => {
    expect(YOLO_DURATIONS_MS).toEqual([15 * MIN, 30 * MIN, 60 * MIN]);
    const y = yolo();
    expect(await y.activate({ durationMs: 5 * MIN, base: mk("repo") })).toEqual({ ok: false, reason: "invalid-duration" });
  });

  it("ending it takes effect on the next denial", async () => {
    const y = yolo();
    const repo = mk("repo");
    await y.activate({ durationMs: 15 * MIN, base: repo });
    y.end();
    expect(ask(y, repo)).toBeNull();
  });
});

describe("8b.2a / 8b.2c-d scope", () => {
  it("8b.2c no choice yields a cwd-scoped session, not an unscoped one", async () => {
    const y = yolo();
    const repo = mk("repo");
    const r = await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(r.ok && r.session).toMatchObject({ unscoped: false, roots: [{ path: repo }] });
    expect(ask(y, mk("elsewhere"))).toBeNull();
  });

  it("#E33 a denial inside any one of several roots is auto-allowed", async () => {
    const y = yolo();
    await y.activate({ durationMs: 15 * MIN, base: mk("repo") });
    await y.addRoot({ base: mk("scratch") });
    expect(ask(y, mk("scratch", "x"))).toBe("auto-allow");
  });

  it("#E34 a path inside a root only BEFORE symlink resolution is not auto-allowed", async () => {
    const y = yolo();
    const repo = mk("repo");
    const outside = mk("outside");
    fs.symlinkSync(outside, path.join(repo, "link"));
    await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(ask(y, path.join(repo, "link"))).toBeNull();
  });

  it("#E35 adding a root keeps the original expiry", async () => {
    const y = yolo();
    const r = await y.activate({ durationMs: 15 * MIN, base: mk("repo") });
    const expires = r.ok ? r.session.expiresAt : -1;
    clock += 12 * MIN;
    await y.addRoot({ base: mk("scratch") });
    expect(y.status()?.expiresAt).toBe(expires);
  });

  it("8b.7b activating while a session is live adds to it, never a second session", async () => {
    const y = yolo();
    const first = await y.activate({ durationMs: 15 * MIN, base: mk("repo") });
    const again = await y.activate({ durationMs: 60 * MIN, base: mk("scratch") });
    expect(again).toMatchObject({ ok: true, added: true });
    expect(y.status()?.expiresAt).toBe(first.ok ? first.session.expiresAt : -1);
    expect(y.status()?.roots).toHaveLength(2);
  });

  it("no number of added roots produces the unscoped state", async () => {
    const y = yolo();
    await y.activate({ durationMs: 15 * MIN, base: mk("r0") });
    for (let i = 1; i < 10; i++) await y.addRoot({ base: mk(`r${i}`) });
    expect(y.status()?.unscoped).toBe(false);
    expect(await y.activate({ durationMs: 15 * MIN, base: mk("r0"), unscoped: true })).toEqual({
      ok: false,
      reason: "cannot-widen-to-unscoped",
    });
  });

  it("#E39 with 10 roots, a denial outside all is not auto-allowed", async () => {
    const y = yolo();
    await y.activate({ durationMs: 15 * MIN, base: mk("r0") });
    for (let i = 1; i < 10; i++) await y.addRoot({ base: mk(`r${i}`) });
    expect(ask(y, mk("outside"))).toBeNull();
  });

  it("8b.2b the offered set is the base plus its ladder, minus forbidden rungs", async () => {
    const repo = mk("repo");
    const parent = mk();
    const y = new YoloController({
      now: () => clock,
      hostGateMode: () => mode,
      isRefused,
      ladder: async () => [parent, os.homedir()],
      onLog: () => {},
    });
    expect(await y.offerRoots(repo)).toEqual([repo, parent]);
    expect(await y.activate({ durationMs: 15 * MIN, base: repo, root: parent })).toMatchObject({ ok: true });
  });

  it("8b.2b a root must be OFFERED: no free-text directory", async () => {
    const y = yolo();
    expect(await y.activate({ durationMs: 15 * MIN, base: mk("repo"), root: mk("unrelated") })).toEqual({
      ok: false,
      reason: "root-not-offered",
    });
  });

  it("#X7 a chosen root deleted before activation is refused, no session", async () => {
    const y = yolo();
    const repo = mk("repo");
    fs.rmSync(repo, { recursive: true });
    expect((await y.activate({ durationMs: 15 * MIN, base: repo })).ok).toBe(false);
    expect(y.status()).toBeNull();
  });

  it("#E38 a $HOME working directory is neither offered nor the default", async () => {
    const y = yolo();
    expect(await y.offerRoots(os.homedir())).not.toContain(fs.realpathSync(os.homedir()));
    expect(await y.activate({ durationMs: 15 * MIN, base: os.homedir() })).toEqual({ ok: false, reason: "no-legal-root" });
  });
});

describe("8b.3 / 8b.4 / 8b.5 what YOLO will and will not answer", () => {
  it("8b.3 a forbidden subject and a descendant of one are still refused under an unscoped session", async () => {
    const y = yolo();
    const home = os.homedir();
    fs.mkdirSync(path.join(home, ".ssh", "keys"), { recursive: true });
    await y.activate({ durationMs: 15 * MIN, base: mk("repo"), unscoped: true });
    expect(ask(y, path.join(home, ".ssh"))).toBeNull();
    expect(ask(y, path.join(home, ".ssh", "keys"))).toBeNull();
  });

  it("8b.4 a request without a capability stays denied while YOLO is active", async () => {
    const y = yolo();
    const repo = mk("repo");
    await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(ask(y, repo, { cap: false })).toBeNull();
  });

  it("8b.4a / #E36 an explicit prior deny is never reversed, and is recorded as such", async () => {
    const y = yolo();
    const repo = mk("repo");
    const env = mk("repo", "secrets");
    recordRefusal("filesystem", env);
    await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(ask(y, env)).toBe("refused-by-prior-refusal");
    expect(ask(y, repo)).toBe("auto-allow");
    expect(y.history().map((h) => h.outcome)).toEqual(["refused-by-prior-refusal", "auto-allowed"]);
  });

  it("8b.5 network, CORS and a deferred plane are never answered", async () => {
    const y = yolo();
    await y.activate({ durationMs: 15 * MIN, base: mk("repo"), unscoped: true });
    const deferred = [
      createNetworkPlane({ readTrustedNetworks: () => [], writeConfigPartial: () => ({ success: true }) }),
      createCorsPlane({ readRawCors: () => ({}), writeConfigPartial: () => ({ success: true }) }),
    ];
    for (const plane of deferred) {
      expect(y.decide({ plane, subject: "203.0.113.9", requestHoldsCapability: true, hostGateMode: "enforce" })).toBeNull();
    }
  });

  it("the cwd plane is YOLO-eligible like the filesystem plane", async () => {
    const y = yolo();
    const repo = mk("repo");
    await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(ask(y, repo, { plane: createCwdPlane({ pinDirectory: () => {} }) })).toBe("auto-allow");
  });

  it("8b.8 auto-answers stay listed after the session ends", async () => {
    const y = yolo();
    const repo = mk("repo");
    await y.activate({ durationMs: 15 * MIN, base: repo });
    ask(y, repo);
    y.end();
    expect(y.history()).toEqual([expect.objectContaining({ subject: repo, outcome: "auto-allowed" })]);
  });
});

describe("8b.6 / 8b.6a / #X10 environment activation", () => {
  it("activates for the process lifetime with no expiry", () => {
    const y = yolo();
    const r = y.activateFromEnv(mk("repo"));
    expect(r).toMatchObject({ ok: true, session: { source: "env", expiresAt: null, unscoped: false } });
    clock += 10 * 60 * MIN;
    expect(y.status()).not.toBeNull();
  });

  it("#E40 two valid roots and one unresolvable: inactive, not unscoped, not the subset", () => {
    const y = yolo();
    const r = y.activateFromEnv(JSON.stringify([mk("a"), mk("b"), path.join(tmp, "missing")]));
    expect(r).toMatchObject({ ok: false });
    expect(y.status()).toBeNull();
  });

  it("a forbidden root keeps it inactive", () => {
    const y = yolo();
    expect(y.activateFromEnv(os.homedir())).toMatchObject({ ok: false });
    expect(y.status()).toBeNull();
  });

  it("an unparseable value leaves it inactive", () => {
    const y = yolo();
    expect(y.activateFromEnv("1")).toMatchObject({ ok: false });
    expect(y.status()).toBeNull();
  });

  it("#X10 in report mode no session becomes active by either path, and nothing is auto-answered", async () => {
    mode = "report";
    const y = yolo();
    expect(y.activateFromEnv("unscoped")).toEqual({ ok: false, reason: "report-mode" });
    expect(await y.activate({ durationMs: 15 * MIN, base: mk("repo") })).toEqual({ ok: false, reason: "report-mode" });
    expect(y.status()).toBeNull();
    mode = "enforce";
    y.activateFromEnv("unscoped");
    mode = "report";
    expect(ask(y, mk("repo"))).toBeNull();
  });
});
