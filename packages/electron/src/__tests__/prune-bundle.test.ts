/**
 * E1–E7 + X1 (slim-windows-install-file-count): the shared bundle prune helper.
 * Drives `pruneBundle` / `main` with temp-dir fixtures shaped like
 * `resources/server` after materialization: `node_modules/` (third-party +
 * `@blackbelt-technology/*` first-party copies), `resources/plugins/<id>/` and
 * `packages/dist/client`.
 *
 * See change: slim-windows-install-file-count (design D1).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { dropWorkspaceCopies, main, pruneBundle } from "../../scripts/lib/prune-bundle.mjs";

interface Stats {
  removedFiles: { thirdParty: number; firstParty: number };
}
type Rm = (p: string, o?: unknown) => void;
const prune = pruneBundle as (dir: string, opts?: { rm?: Rm; log?: (m: string) => void }) => Stats;
const runMain = main as (argv: string[], deps?: { rm?: Rm; log?: (m: string) => void; error?: (m: string) => void }) => number;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Fresh `resources/server`-shaped dir; `files` are paths relative to it. */
function bundle(files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "prune-bundle-"));
  dirs.push(dir);
  for (const f of files) {
    const full = path.join(dir, ...f.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "x");
  }
  return dir;
}
const has = (dir: string, rel: string) => existsSync(path.join(dir, ...rel.split("/")));
const BB = "node_modules/@blackbelt-technology";

describe("pruneBundle — third-party rule set", () => {
  it("E1: removes .d.ts/.d.mts/.d.cts, keeps the runtime file", () => {
    const d = bundle([
      "node_modules/foo/index.js",
      "node_modules/foo/index.d.mts",
      "node_modules/foo/index.d.cts",
      "node_modules/foo/index.d.ts",
    ]);
    prune(d, { log: () => {} });
    expect(has(d, "node_modules/foo/index.js")).toBe(true);
    for (const n of ["index.d.mts", "index.d.cts", "index.d.ts"]) expect(has(d, `node_modules/foo/${n}`)).toBe(false);
  });

  it("keeps today's rules: .md/.map/CHANGELOG/LICENSE and __tests__/test directories", () => {
    const d = bundle([
      "node_modules/foo/index.js",
      "node_modules/foo/README.md",
      "node_modules/foo/index.js.map",
      "node_modules/foo/CHANGELOG.txt",
      "node_modules/foo/LICENSE",
      "node_modules/foo/__tests__/a.js",
      "node_modules/foo/test/b.js",
      "node_modules/foo/tests/c.js",
    ]);
    prune(d, { log: () => {} });
    expect(has(d, "node_modules/foo/index.js")).toBe(true);
    for (const n of ["README.md", "index.js.map", "CHANGELOG.txt", "LICENSE", "__tests__", "test", "tests"]) {
      expect(has(d, `node_modules/foo/${n}`), n).toBe(false);
    }
  });

  it("E2: never removes a directory that holds a package.json (any depth)", () => {
    const d = bundle([
      "node_modules/test/package.json",
      "node_modules/test/lib/index.js",
      "node_modules/a/node_modules/tests/package.json",
      "node_modules/b/test/x.js",
    ]);
    prune(d, { log: () => {} });
    expect(has(d, "node_modules/test/package.json")).toBe(true);
    expect(has(d, "node_modules/test/lib/index.js")).toBe(true);
    expect(has(d, "node_modules/a/node_modules/tests/package.json")).toBe(true);
    expect(has(d, "node_modules/b/test")).toBe(false);
  });

  it("E3: keeps LICENSE.third-party.md, drops the plain LICENSE", () => {
    const d = bundle([
      "node_modules/@napi-rs/keyring-linux-x64-gnu/LICENSE",
      "node_modules/@napi-rs/keyring-linux-x64-gnu/LICENSE.third-party.md",
    ]);
    prune(d, { log: () => {} });
    expect(has(d, "node_modules/@napi-rs/keyring-linux-x64-gnu/LICENSE.third-party.md")).toBe(true);
    expect(has(d, "node_modules/@napi-rs/keyring-linux-x64-gnu/LICENSE")).toBe(false);
  });
});

describe("pruneBundle — first-party rule set", () => {
  it("E4: removes only AGENTS.md sidecars outside .pi/ and __tests__", () => {
    const ext = `${BB}/pi-dashboard-extension`;
    const d = bundle([
      `${ext}/src/AGENTS.md`,
      `${ext}/src/bridge.ts.AGENTS.md`,
      `${ext}/src/bridge.ts`,
      `${ext}/src/__tests__/a.test.ts`,
      `${ext}/README.md`,
      `${ext}/.pi/skills/browser/SKILL.md`,
      `${ext}/.pi/skills/browser/LICENSE`,
      `${ext}/.pi/skills/browser/UPSTREAM.md`,
      `${ext}/.pi/skills/browser/AGENTS.md`,
      `${ext}/commands/x.md`,
      `${ext}/agents/y.md`,
    ]);
    prune(d, { log: () => {} });
    expect(has(d, `${ext}/src/AGENTS.md`)).toBe(false);
    expect(has(d, `${ext}/src/bridge.ts.AGENTS.md`)).toBe(false);
    expect(has(d, `${ext}/src/__tests__`)).toBe(false);
    for (const keep of [
      "src/bridge.ts",
      "README.md",
      ".pi/skills/browser/SKILL.md",
      ".pi/skills/browser/LICENSE",
      ".pi/skills/browser/UPSTREAM.md",
      ".pi/skills/browser/AGENTS.md",
      "commands/x.md",
      "agents/y.md",
    ]) {
      expect(has(d, `${ext}/${keep}`), keep).toBe(true);
    }
  });

  it("E5: applies the same rules under resources/plugins/<id>", () => {
    const k = "resources/plugins/kb";
    const d = bundle([`${k}/AGENTS.md`, `${k}/src/x.ts.AGENTS.md`, `${k}/src/x.ts`, `${k}/.pi/skills/s/SKILL.md`]);
    prune(d, { log: () => {} });
    expect(has(d, `${k}/AGENTS.md`)).toBe(false);
    expect(has(d, `${k}/src/x.ts.AGENTS.md`)).toBe(false);
    expect(has(d, `${k}/src/x.ts`)).toBe(true);
    expect(has(d, `${k}/.pi/skills/s/SKILL.md`)).toBe(true);
  });

  it("E6: leaves the served client untouched (both copies)", () => {
    const d = bundle([`${BB}/pi-dashboard-web/dist/a.js.map`, `${BB}/pi-dashboard-web/dist/LICENSE.txt`, "packages/dist/client/b.js.map"]);
    prune(d, { log: () => {} });
    expect(has(d, `${BB}/pi-dashboard-web/dist/a.js.map`)).toBe(true);
    expect(has(d, `${BB}/pi-dashboard-web/dist/LICENSE.txt`)).toBe(true);
    expect(has(d, "packages/dist/client/b.js.map")).toBe(true);
  });

  it("E7: keeps first-party runtime TypeScript source, including .d.ts", () => {
    const s = `${BB}/pi-dashboard-server/src`;
    const d = bundle([`${s}/cli.ts`, `${s}/types.d.ts`]);
    prune(d, { log: () => {} });
    expect(has(d, `${s}/cli.ts`)).toBe(true);
    expect(has(d, `${s}/types.d.ts`)).toBe(true);
  });

  it("a node_modules nested inside a first-party package is pruned as third-party", () => {
    const n = `${BB}/pi-dashboard-shared/node_modules/dep`;
    const d = bundle([`${n}/index.js`, `${n}/index.d.ts`]);
    prune(d, { log: () => {} });
    expect(has(d, `${n}/index.js`)).toBe(true);
    expect(has(d, `${n}/index.d.ts`)).toBe(false);
  });

  it("reports removed files per group, counting files inside removed directories", () => {
    const d = bundle([
      "node_modules/foo/a.js",
      "node_modules/foo/a.d.ts",
      "node_modules/foo/test/1.js",
      "node_modules/foo/test/2.js",
      `${BB}/pi-dashboard-kb/AGENTS.md`,
    ]);
    const stats = prune(d, { log: () => {} });
    expect(stats.removedFiles).toEqual({ thirdParty: 3, firstParty: 1 });
  });
});

describe("pruneBundle — failure handling", () => {
  it("X1: a filesystem error throws naming the path; the CLI wrapper exits non-zero", () => {
    const d = bundle(["node_modules/foo/index.js", "node_modules/foo/index.d.ts"]);
    const target = path.join(d, "node_modules", "foo", "index.d.ts");
    const rm: Rm = (p) => {
      if (p === target) throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    };
    expect(() => prune(d, { rm, log: () => {} })).toThrow(target);

    const errors: string[] = [];
    const code = runMain([d], { rm, log: () => {}, error: (m) => errors.push(m) });
    expect(code).not.toBe(0);
    expect(errors.join("\n")).toContain(target);
  });

  it("the CLI wrapper exits 0 on success and non-zero without a directory argument", () => {
    const d = bundle(["node_modules/foo/index.js"]);
    expect(runMain([d], { log: () => {}, error: () => {} })).toBe(0);
    expect(runMain([], { log: () => {}, error: () => {} })).not.toBe(0);
  });

  it("a missing server dir exits 2 instead of pruning nothing", () => {
    const errors: string[] = [];
    const code = runMain([path.join(os.tmpdir(), "prune-bundle-no-such-dir")], { log: () => {}, error: (m) => errors.push(m) });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("not found");
  });
});

describe("dropWorkspaceCopies / --finalize", () => {
  it("deletes every packages/* child except dist and empties workspaces (the findMonorepoRoot marker)", () => {
    const d = bundle(["packages/server/src/cli.ts", "packages/extension/src/bridge.ts", "packages/dist/client/index.html"]);
    writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "b", workspaces: ["packages/server"], dependencies: { a: "1" } }));
    const removed = (dropWorkspaceCopies as (dir: string, o?: object) => string[])(d, { log: () => {} });
    expect(removed.sort()).toEqual(["extension", "server"]);
    expect(has(d, "packages/server")).toBe(false);
    expect(has(d, "packages/extension")).toBe(false);
    expect(has(d, "packages/dist/client/index.html")).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(d, "package.json"), "utf8"));
    expect(pkg.workspaces).toEqual([]);
    expect(pkg.dependencies).toEqual({ a: "1" });
  });

  it("--finalize runs the workspace drop and then the prune", () => {
    const d = bundle(["packages/server/src/cli.ts", "node_modules/foo/index.js", "node_modules/foo/index.d.ts"]);
    expect(runMain(["--finalize", d], { log: () => {}, error: () => {} })).toBe(0);
    expect(has(d, "packages/server")).toBe(false);
    expect(has(d, "node_modules/foo/index.d.ts")).toBe(false);
  });
});
