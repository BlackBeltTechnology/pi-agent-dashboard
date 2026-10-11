/**
 * Behavioural contract for `platform/exec.ts`: every wrapper hands
 * `windowsHide: true` to `node:child_process` unless the caller passes an
 * explicit `windowsHide: false`.
 *
 * Node does not expose the final spawn options, so `node:child_process` is
 * mocked and the options each wrapper forwards are captured. Replaces a
 * source-text assertion on `exec.ts`. See change: test-trust-audit (design D4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ fn: string; options: { windowsHide?: boolean } | undefined }> = [];

vi.mock("node:child_process", () => {
  const rec =
    (fn: string, optionsIndex: number) =>
    (...args: unknown[]) => {
      // Callback forms may pass the options slot as the callback; `withHide(undefined)` fills it.
      const slot = args[optionsIndex];
      calls.push({ fn, options: typeof slot === "object" && slot !== null ? (slot as { windowsHide?: boolean }) : undefined });
      return fn.endsWith("Sync") ? "" : {};
    };
  return {
    execSync: rec("execSync", 1),
    execFileSync: rec("execFileSync", 2),
    spawnSync: rec("spawnSync", 2),
    exec: rec("exec", 1),
    execFile: rec("execFile", 2),
    spawn: rec("spawn", 2),
  };
});

import { exec, execFile, execFileSync, execSync, spawn, spawnSync } from "../platform/exec.js";

const WRAPPERS: Array<[string, (opts?: { windowsHide?: boolean }) => unknown]> = [
  ["execSync", (o) => execSync("x", o)],
  ["execFileSync", (o) => execFileSync("x", [], o)],
  ["spawnSync", (o) => spawnSync("x", [], o)],
  ["exec", (o) => exec("x", o as never, (() => {}) as never)],
  ["execFile", (o) => execFile("x", [], o as never, (() => {}) as never)],
  ["spawn", (o) => spawn("x", [], o)],
];

describe("platform/exec windowsHide default", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it.each(WRAPPERS)("%s defaults windowsHide to true when the caller omits it", (name, call) => {
    call(undefined);
    expect(calls.find((c) => c.fn === name)?.options?.windowsHide).toBe(true);
  });

  it.each(WRAPPERS.filter(([n]) => n !== "spawnSync"))("%s honours an explicit windowsHide: false", (name, call) => {
    call({ windowsHide: false });
    expect(calls.find((c) => c.fn === name)?.options?.windowsHide).toBe(false);
  });

  it("spawnSync honours an explicit windowsHide: false", () => {
    spawnSync("x", [], { windowsHide: false });
    expect(calls.find((c) => c.fn === "spawnSync")?.options?.windowsHide).toBe(false);
  });
});
