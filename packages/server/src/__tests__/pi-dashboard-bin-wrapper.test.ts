/**
 * Tests for `packages/server/bin/pi-dashboard.mjs` — the published CLI
 * bin entry. Spawns the wrapper as a child process to exercise the
 * real jiti-resolution + re-exec behaviour.
 *
 * See change: replace-tsx-with-jiti.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(here, "..", "..", "bin", "pi-dashboard.mjs");
const repoNodeModules = path.resolve(here, "..", "..", "..", "..", "node_modules");
const repoJitiRegister = path.join(repoNodeModules, "jiti", "lib", "jiti-register.mjs");

describe("bin/pi-dashboard.mjs wrapper", () => {
  beforeAll(() => {
    if (!existsSync(wrapperPath)) {
      throw new Error(`Wrapper missing at ${wrapperPath}`);
    }
  });

  it("exits 1 with install-hint when jiti cannot be resolved", () => {
    // Build an isolated anchor with NO node_modules tree — createRequire on
    // it will fail to resolve `jiti/package.json`, triggering the miss path.
    const tmp = mkdtempSync(path.join(tmpdir(), "pi-dashboard-bin-test-"));
    try {
      const fakeAnchor = path.join(tmp, "fake-anchor.js");
      writeFileSync(fakeAnchor, "// no-op anchor with no node_modules\n");

      // Spawn the wrapper. We override process.argv[1] indirectly by
      // invoking node with `<wrapper>` then forcing argv[1] to the fake
      // anchor via a tiny preamble — but the wrapper reads its OWN
      // process.argv[1] which is the wrapper path itself when invoked
      // directly. Strategy: copy the wrapper into the isolated tmp dir so
      // its argv[1] resolves there with no jiti adjacency.
      const isolatedWrapper = path.join(tmp, "pi-dashboard.mjs");
      const wrapperSrc = require("node:fs").readFileSync(wrapperPath, "utf-8");
      writeFileSync(isolatedWrapper, wrapperSrc);

      const result = spawnSync(process.execPath, [isolatedWrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find jiti");
      expect(result.stderr).toContain("npm install -g @earendil-works/pi-coding-agent");
      // No tsx mention — proposal mandates no-fallback wrapper.
      expect(result.stderr).not.toMatch(/tsx/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves jiti from process.argv[1] anchor and re-execs cli.ts", () => {
    // Repo root has jiti at node_modules/jiti — wrapper invoked with its
    // real path SHOULD walk createRequire(realpath(argv[1])) up into the
    // repo's node_modules and find jiti.
    if (!existsSync(repoJitiRegister)) {
      // CI / fresh clone without `npm install` — skip rather than fail.
      return;
    }

    // Use `status` — it doesn't bind ports and exits quickly regardless
    // of whether a server is running. We don't care about exit code (0 if
    // a dashboard is up, 1 if not — both are valid outcomes that prove
    // the wrapper successfully resolved jiti and re-execed cli.ts). What
    // we DO care about: (a) no jiti-miss error on stderr, (b) cli.ts
    // produced its own "Dashboard server" output (running OR not running).
    const result = spawnSync(process.execPath, [wrapperPath, "status"], {
      encoding: "utf-8",
      timeout: 30_000,
    });

    expect(result.stderr).not.toContain("pi-dashboard: cannot find jiti");
    expect(result.stdout).toMatch(/Dashboard server/i);
  }, 60_000);

  // The wrapper re-stamps NODE_OPTIONS for the server child. It must leave a
  // quoted operator value byte-for-byte: a split/join collapses the repeated
  // spaces below and the child can no longer find the --require'd file.
  // See change: guard-server-heap-and-store-coupling (CodeRabbit PR #780 sweep).
  it("preserves a quoted NODE_OPTIONS value with repeated spaces for the server child", () => {
    if (!existsSync(repoJitiRegister)) return;
    const tmp = mkdtempSync(path.join(tmpdir(), "wrap-quoted-"));
    try {
      const dir = path.join(tmp, "my  hooks");
      mkdirSync(dir, { recursive: true });
      const out = path.join(tmp, "seen.txt");
      writeFileSync(
        path.join(dir, "probe.cjs"),
        `require("node:fs").appendFileSync(${JSON.stringify(out)}, process.env.NODE_OPTIONS + "\\n");`,
      );
      const quoted = `--require "${path.join(dir, "probe.cjs")}"`;
      const home = path.join(tmp, "home");
      mkdirSync(home);
      // No prior stamp, then a prior stamp of ours (marker-matched) to replace.
      const prior = "--max-old-space-size=8192";
      for (const [nodeOptions, marker] of [
        [quoted, ""],
        [`${quoted} ${prior}`, prior],
      ]) {
        rmSync(out, { force: true });
        const result = spawnSync(process.execPath, [wrapperPath, "status"], {
          encoding: "utf-8",
          timeout: 30_000,
          env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: nodeOptions, PI_DASHBOARD_HEAP_FLAG: marker },
        });
        expect(result.stderr).not.toMatch(/Cannot find module/);
        const lines = readFileSync(out, "utf-8").trim().split("\n");
        // Line 1: the wrapper itself; last line: the server child it spawned.
        expect(lines.at(-1)).toBe(`${quoted} --max-old-space-size=1536`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
