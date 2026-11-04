/**
 * `buildSpawnEnv` sets `PWD` to the canonical spawn cwd (issue #1079).
 *
 * Covers change fix-spawned-session-pwd tasks 1.1–1.8 — test-plan E1–E7, X1.
 * Spec headless-spawn "`PI_DASHBOARD_SPAWN_TOKEN` env-var injected on every
 * spawn" (sanctioned `PWD` rewrite scenarios).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

let T: string;

beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pwd-"));
});

afterEach(() => {
  fs.rmSync(T, { recursive: true, force: true });
});

const canon = (p: string) => fs.realpathSync(p);
const baseWith = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...extra,
});

describe("buildSpawnEnv cwd → PWD", () => {
  it("E1: rewrites a stale inherited PWD to the canonical spawn cwd, without mutating the base", () => {
    const base = baseWith({ PWD: "/launch/dir" });
    const env = buildSpawnEnv(base, { cwd: T });
    expect(env.PWD).toBe(canon(T));
    expect(base.PWD).toBe("/launch/dir");
  });

  it("E2 (guard): absent cwd leaves PWD as inherited / absent", () => {
    const withPwd = buildSpawnEnv(baseWith({ PWD: "/launch/dir" }), { spawnToken: "t" });
    expect(withPwd.PWD).toBe("/launch/dir");
    const withoutPwd = buildSpawnEnv(baseWith(), { spawnToken: "t" });
    expect("PWD" in withoutPwd).toBe(false);
  });

  it("empty cwd is treated as absent (no server-cwd re-stamp)", () => {
    const env = buildSpawnEnv(baseWith({ PWD: "/launch/dir" }), { cwd: "" });
    expect(env.PWD).toBe("/launch/dir");
  });

  it("E3: sets PWD when the base env has none", () => {
    const env = buildSpawnEnv(baseWith(), { cwd: T });
    expect(env.PWD).toBe(canon(T));
  });

  it.skipIf(process.platform === "win32")("E4: a symlinked cwd yields the physical path", () => {
    fs.mkdirSync(path.join(T, "real"));
    fs.symlinkSync(path.join(T, "real"), path.join(T, "link"));
    const env = buildSpawnEnv(baseWith(), { cwd: path.join(T, "link") });
    expect(env.PWD).toBe(canon(path.join(T, "real")));
  });

  it.each([
    ["trailing separator", () => T + path.sep],
    ["dot segments", () => `${T}/./sub/..`],
    ["relative", () => path.relative(process.cwd(), T)],
  ])("E5: %s spelling yields the canonical absolute PWD", (_label, spell) => {
    fs.mkdirSync(path.join(T, "sub"), { recursive: true });
    const env = buildSpawnEnv(baseWith(), { cwd: spell() });
    expect(env.PWD).toBe(canon(T));
    expect(path.isAbsolute(env.PWD as string)).toBe(true);
    expect((env.PWD as string).endsWith(path.sep)).toBe(false);
  });

  it("E6: space and non-ASCII characters survive byte-exact", () => {
    const cwd = path.join(T, "a b", "é-ü");
    fs.mkdirSync(cwd, { recursive: true });
    const env = buildSpawnEnv(baseWith(), { cwd });
    expect(env.PWD).toBe(canon(cwd));
  });

  it("E7: every other variable is unaffected; context-mode dir names are never host-set", () => {
    const base = baseWith({ CONTEXT_MODE_TZ: "UTC", FOO: "1", PWD: "/launch/dir" });
    const withCwd = buildSpawnEnv(base, { cwd: T });
    const withoutCwd = buildSpawnEnv(base, {});
    const { PWD: _a, ...restWith } = withCwd;
    const { PWD: _b, ...restWithout } = withoutCwd;
    expect(restWith).toEqual(restWithout);
    for (const name of ["PI_WORKSPACE_DIR", "CONTEXT_MODE_PROJECT_DIR", "PI_PROJECT_DIR"]) {
      expect(name in withCwd).toBe(false);
    }
    const variant = buildSpawnEnv({ ...base, PI_PROJECT_DIR: "/op" }, { cwd: T });
    expect(variant.PI_PROJECT_DIR).toBe("/op");
    expect(variant.PWD).toBe(canon(T));
  });

  it("X1: an unresolvable cwd falls back to the absolute lexical form without throwing", () => {
    expect(buildSpawnEnv(baseWith(), { cwd: "/nonexistent/fsp-1079" }).PWD).toBe(
      path.resolve("/nonexistent/fsp-1079"),
    );
    expect(buildSpawnEnv(baseWith(), { cwd: "nope/fsp-1079" }).PWD).toBe(
      path.resolve(process.cwd(), "nope/fsp-1079"),
    );
  });
});
