/**
 * #X12 — omitting `surface` is a compile-time error (no default presenter).
 *
 * Runs the repo's own `tsc` on (a) the in-tree fixture carrying
 * `@ts-expect-error` (must exit 0: the error is present, the directive is used)
 * and (b) the same call WITHOUT the directive (must exit non-zero and name
 * TS2345/`surface`) — the control that makes (a) non-vacuous.
 *
 * @structural-pin the control rewrites the fixture source text (drops the directive) to prove the error is real.
 * See change: add-supervised-tool-approval.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/lib/tsc.js");
const fixture = path.resolve(__dirname, "fixtures/missing-surface.ts");

function runTsc(file: string) {
  return spawnSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--allowImportingTsExtensions",
      file,
    ],
    { encoding: "utf8" },
  );
}

describe("X12: ApprovalSurface is required", () => {
  it("the @ts-expect-error fixture compiles clean (the error is present)", () => {
    const r = runTsc(fixture);
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("control: without the directive the same call is a type error naming `surface`", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x12-"));
    try {
      const src = readFileSync(fixture, "utf8")
        .replace(/^\/\/ @ts-expect-error.*\n/m, "")
        .replace("../../guard.js", path.resolve(__dirname, "../guard.ts"));
      const control = path.join(dir, "control.ts");
      writeFileSync(control, src);
      const r = runTsc(control);
      expect(r.status).not.toBe(0);
      expect(r.stdout).toMatch(/surface/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
