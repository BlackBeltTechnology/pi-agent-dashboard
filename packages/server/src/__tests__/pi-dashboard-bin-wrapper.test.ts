/**
 * Tests for `packages/server/bin/pi-dashboard.mjs` — the published CLI
 * bin entry. Spawns the wrapper as a child process to exercise the
 * real jiti-resolution + re-exec behaviour.
 *
 * See change: replace-tsx-with-jiti.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";
import { realpathSync, symlinkSync } from "node:fs";
import { wrapperEntryArg } from "@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs";
import { shouldUrlWrapEntry, toFileUrl } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";

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
        env: { ...process.env, NODE_PATH: "", PI_DASHBOARD_TS_LOADER: "jiti" },
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

  // `start` with no resolvable jiti: the corrupted-install message, no tsx
  // fallback (test-plan #X1). See change: cleanup-stale-fork-specs.
  it("`start` with no jiti exits 1 with the corrupted-install message", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "pi-dashboard-bin-start-"));
    try {
      const isolatedWrapper = path.join(tmp, "pi-dashboard.mjs");
      writeFileSync(isolatedWrapper, readFileSync(wrapperPath, "utf-8"));

      const result = spawnSync(process.execPath, [isolatedWrapper, "start"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "", PI_DASHBOARD_TS_LOADER: "jiti" },
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr.startsWith("pi-dashboard: cannot find jiti.")).toBe(true);
      expect(result.stderr).toContain("corrupted");
      expect(result.stderr).toContain("npm install -g @blackbelt-technology/pi-agent-dashboard");
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
      // Repeated spaces AND the wrapper's own prior token inside the quoted
      // path (CodeRabbit PR #780 rounds 1-2).
      const dir = path.join(tmp, "my  hooks --max-old-space-size=8192 x");
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

/**
 * E14–E16 — loader selection in the wrapper. A fake install tree in a temp dir:
 *   <tmp>/node_modules/@blackbelt-technology/pi-dashboard-shared → packages/shared
 *   <tmp>/pkg/{package.json, bin/pi-dashboard.mjs, src/cli.ts}
 * No jiti is resolvable from it. The stub `cli.ts` prints the child's
 * `execArgv` + `argv` so the spawned argv is observable.
 * See change: fix-appimage-cold-boot-latency (design D4, D8).
 */
describe("bin/pi-dashboard.mjs — TS loader selection", () => {
  const sharedPkg = path.resolve(here, "..", "..", "..", "shared");
  const tmps: string[] = [];
  afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

  function fakeInstall(): string {
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-dashboard-bin-loader-")));
    tmps.push(tmp);
    mkdirSync(path.join(tmp, "node_modules", "@blackbelt-technology"), { recursive: true });
    symlinkSync(sharedPkg, path.join(tmp, "node_modules", "@blackbelt-technology", "pi-dashboard-shared"), "dir");
    mkdirSync(path.join(tmp, "pkg", "bin"), { recursive: true });
    mkdirSync(path.join(tmp, "pkg", "src"), { recursive: true });
    writeFileSync(path.join(tmp, "pkg", "package.json"), JSON.stringify({ name: "fake", version: "9.9.9", type: "module" }));
    writeFileSync(path.join(tmp, "pkg", "bin", "pi-dashboard.mjs"), readFileSync(wrapperPath, "utf-8"));
    writeFileSync(
      path.join(tmp, "pkg", "src", "cli.ts"),
      `const out: string = JSON.stringify({ execArgv: process.execArgv, argv: process.argv.slice(1) });\nconsole.log("CHILD " + out);\n`,
    );
    return tmp;
  }

  function runWrapper(tmp: string, args: string[], loaderEnv?: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: "", HOME: tmp, USERPROFILE: tmp };
    delete env.PI_DASHBOARD_TS_LOADER;
    if (loaderEnv !== undefined) env.PI_DASHBOARD_TS_LOADER = loaderEnv;
    return spawnSync(process.execPath, [path.join(tmp, "pkg", "bin", "pi-dashboard.mjs"), ...args], {
      encoding: "utf-8", env, timeout: 30_000,
    });
  }

  function childArgv(stdout: string): { execArgv: string[]; argv: string[] } {
    const line = stdout.split("\n").find((l) => l.startsWith("CHILD "));
    if (!line) throw new Error(`no CHILD line in stdout: ${stdout}`);
    return JSON.parse(line.slice("CHILD ".length));
  }

  it("E14: env unset → native register, raw entry on POSIX, no jiti lookup", () => {
    const tmp = fakeInstall();
    const res = runWrapper(tmp, ["status"]);
    expect(res.stderr).not.toContain("cannot find jiti");
    expect(res.status).toBe(0);
    const child = childArgv(res.stdout);
    const i = child.execArgv.indexOf("--import");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(child.execArgv[i + 1]).toMatch(/^file:\/\/.*\/platform\/native-ts-register\.mjs$/);
    expect(child.argv[0]).toBe(path.join(tmp, "pkg", "src", "cli.ts"));
    expect(child.argv.slice(1)).toEqual(["status"]);
  }, 60_000);

  it("E15: wrapperEntryArg mirrors shouldUrlWrapEntry in all 4 cells", () => {
    const loaders = {
      native: "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs",
      jiti: "file:///x/node_modules/jiti/lib/jiti-register.mjs",
    } as const;
    for (const platform of ["win32", "linux"] as const) {
      for (const kind of ["native", "jiti"] as const) {
        const entry = platform === "win32" ? "B:\\Dev\\cli.ts" : "/x/cli.ts";
        const wrap = shouldUrlWrapEntry(loaders[kind], platform);
        expect(wrapperEntryArg(kind, entry, platform)).toBe(wrap ? toFileUrl(entry) : entry);
      }
    }
    expect(wrapperEntryArg("native", "B:\\Dev\\cli.ts", "win32")).toBe("file:///B:/Dev/cli.ts");
  });

  it("E16: missing jiti is fatal only for the jiti opt-in; --version never needs a loader", () => {
    const tmp = fakeInstall();
    const nativeStart = runWrapper(tmp, ["start"]);
    expect(nativeStart.stderr).not.toContain("cannot find jiti");
    expect(childArgv(nativeStart.stdout).argv.slice(1)).toEqual(["start"]);

    const jitiStart = runWrapper(tmp, ["start"], "jiti");
    expect(jitiStart.status).toBe(1);
    expect(jitiStart.stderr.startsWith("pi-dashboard: cannot find jiti.")).toBe(true);

    for (const loaderEnv of [undefined, "jiti"]) {
      const v = runWrapper(tmp, ["--version"], loaderEnv);
      expect(v.status).toBe(0);
      expect(v.stdout.trim()).toBe("9.9.9");
    }
  }, 60_000);
});
