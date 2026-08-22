/**
 * scripts/merge-latest-mac.py — the arm64 + x64 latest-mac.yml merge.
 *
 * Covers test-plan U6: the `minimumSystemVersion` update gate must survive the
 * merge. The merge seeds root keys from whichever file the caller's glob yields
 * FIRST, so a leg-asymmetric injection would make the shipped gate depend on
 * glob order rather than intent — the script rejects that instead of silently
 * inheriting.
 *
 * Skips when python3/pyyaml is unavailable on a DEV machine. Under CI it does
 * NOT skip — a gate that silently runs zero assertions on the one machine that
 * matters is not a gate, so a missing interpreter is a loud failure there.
 *
 * See change: upgrade-electron-runtime.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "..", "merge-latest-mac.py");

const pyyaml = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
const havePyyaml = pyyaml.status === 0;

describe("the merge contract is actually exercised", () => {
  it("has python3 + pyyaml available (required under CI, advisory locally)", () => {
    // Under CI this must hold, or the suites below skip silently and the macOS
    // update gate ships unverified. Locally a missing interpreter is fine.
    if (!process.env.CI) return;
    expect(
      havePyyaml,
      `python3 with pyyaml is required in CI. python3 -c 'import yaml' said: ${
        pyyaml.stderr || pyyaml.error?.message || "not found"
      }`,
    ).toBe(true);
  });
});

function leg({ arch, minimumSystemVersion }) {
  const lines = [
    "version: 0.7.1",
    "files:",
    `  - url: PI-Dashboard-0.7.1-${arch}.dmg`,
    `    sha512: sha-${arch}`,
    "    size: 123",
    `path: PI-Dashboard-0.7.1-${arch}.dmg`,
    `sha512: sha-${arch}`,
    "releaseDate: '2026-08-22T00:00:00.000Z'",
  ];
  if (minimumSystemVersion !== undefined) {
    lines.push(`minimumSystemVersion: ${minimumSystemVersion}`);
  }
  return `${lines.join("\n")}\n`;
}

function runMerge(legs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-latest-mac-"));
  const paths = legs.map((content, i) => {
    const p = path.join(dir, `leg-${i}`, "latest-mac.yml");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  });
  const res = spawnSync("python3", [SCRIPT, ...paths], { encoding: "utf8" });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    merged: fs.existsSync(paths[0]) ? fs.readFileSync(paths[0], "utf8") : null,
    paths,
  };
}

describe.skipIf(!havePyyaml)("U6: the update gate survives the arm64 + x64 merge", () => {
  it("retains minimumSystemVersion when both legs inject it", () => {
    const r = runMerge([
      leg({ arch: "arm64", minimumSystemVersion: "21.0.0" }),
      leg({ arch: "x64", minimumSystemVersion: "21.0.0" }),
    ]);
    expect(r.status).toBe(0);
    expect(r.merged).toMatch(/^minimumSystemVersion: 21\.0\.0$/m);
  });

  it("still lists every arch's DMG in files[]", () => {
    const r = runMerge([
      leg({ arch: "arm64", minimumSystemVersion: "21.0.0" }),
      leg({ arch: "x64", minimumSystemVersion: "21.0.0" }),
    ]);
    expect(r.merged).toContain("PI-Dashboard-0.7.1-arm64.dmg");
    expect(r.merged).toContain("PI-Dashboard-0.7.1-x64.dmg");
    // The extra legs are consumed so only the merged file uploads.
    expect(fs.existsSync(r.paths[1])).toBe(false);
  });

  it("REJECTS a leg-asymmetric injection instead of depending on glob order", () => {
    // The failure this guards: the arm64 leg (glob-first) carries no field, so
    // the merged output silently loses the gate and every below-floor client is
    // offered an artifact its OS refuses to launch.
    const r = runMerge([
      leg({ arch: "arm64" }),
      leg({ arch: "x64", minimumSystemVersion: "21.0.0" }),
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/disagree on minimumSystemVersion/);
    expect(r.stdout).toMatch(/glob order/);
  });

  it("REJECTS the mirror case too (glob-first leg carries it, the other does not)", () => {
    const r = runMerge([
      leg({ arch: "arm64", minimumSystemVersion: "21.0.0" }),
      leg({ arch: "x64" }),
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/disagree on minimumSystemVersion/);
  });

  it("REJECTS legs that inject different values", () => {
    const r = runMerge([
      leg({ arch: "arm64", minimumSystemVersion: "21.0.0" }),
      leg({ arch: "x64", minimumSystemVersion: "20.0.0" }),
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/disagree on minimumSystemVersion/);
  });
});

describe.skipIf(!havePyyaml)("the merge keeps its pre-existing contract", () => {
  it("merges legs that carry no gate field at all", () => {
    const r = runMerge([leg({ arch: "arm64" }), leg({ arch: "x64" })]);
    expect(r.status).toBe(0);
    expect(r.merged).not.toMatch(/minimumSystemVersion/);
    expect(r.merged).toContain("PI-Dashboard-0.7.1-arm64.dmg");
    expect(r.merged).toContain("PI-Dashboard-0.7.1-x64.dmg");
  });

  it("mirrors path/sha512 from the first file for legacy readers", () => {
    const r = runMerge([
      leg({ arch: "arm64", minimumSystemVersion: "21.0.0" }),
      leg({ arch: "x64", minimumSystemVersion: "21.0.0" }),
    ]);
    expect(r.merged).toMatch(/^path: PI-Dashboard-0\.7\.1-arm64\.dmg$/m);
    expect(r.merged).toMatch(/^sha512: sha-arm64$/m);
  });

  it("is a no-op for a single leg", () => {
    const r = runMerge([leg({ arch: "arm64", minimumSystemVersion: "21.0.0" })]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no merge needed/);
  });
});
