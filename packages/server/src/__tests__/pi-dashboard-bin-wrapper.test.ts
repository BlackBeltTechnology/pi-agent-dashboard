/**
 * Tests for `packages/server/bin/pi-dashboard.mjs` — the published CLI
 * bin entry. Spawns the wrapper as a child process to exercise the
 * real native-loader resolution + re-exec behaviour.
 *
 * See change: replace-tsx-with-jiti; strip-only-native-ts-loader (test-plan #E14, #E21).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";
import { realpathSync, symlinkSync } from "node:fs";
import { shouldUrlWrapEntry } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(here, "..", "..", "bin", "pi-dashboard.mjs");
const repoNodeModules = path.resolve(here, "..", "..", "..", "..", "node_modules");
const repoNativeRegister = path.resolve(here, "..", "..", "..", "shared", "src", "platform", "native-ts-register.mjs");

describe("bin/pi-dashboard.mjs wrapper", () => {
  beforeAll(() => {
    if (!existsSync(wrapperPath)) {
      throw new Error(`Wrapper missing at ${wrapperPath}`);
    }
  });

  // The register module does not resolve from an isolated copy (no node_modules
  // tree): the wrapper prints the corrupted-install hint and exits 1. It never
  // probes jiti or tsx. See #E21.
  it.each([["--version"], ["start"]])("`%s` with no resolvable register module exits 1 with the corrupted-install hint", (arg) => {
    const tmp = mkdtempSync(path.join(tmpdir(), "pi-dashboard-bin-test-"));
    try {
      // Copy the wrapper into the isolated tmp dir so its own location has no
      // node_modules adjacency (and no sibling package.json for --version).
      const isolatedWrapper = path.join(tmp, "pi-dashboard.mjs");
      writeFileSync(isolatedWrapper, readFileSync(wrapperPath, "utf-8"));

      const result = spawnSync(process.execPath, [isolatedWrapper, arg], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr.startsWith("pi-dashboard: cannot find the native TypeScript loader")).toBe(true);
      expect(result.stderr).toContain("corrupted");
      expect(result.stderr).toContain("npm install -g @blackbelt-technology/pi-agent-dashboard");
      expect(result.stderr).not.toMatch(/tsx|jiti/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves the native register module from the process.argv[1] anchor and re-execs cli.ts", () => {
    // Use `status` — it doesn't bind ports and exits quickly regardless
    // of whether a server is running. We don't care about exit code (0 if
    // a dashboard is up, 1 if not — both prove the wrapper resolved the
    // loader and re-execed cli.ts). What we DO care about: (a) no
    // corrupted-install error on stderr, (b) cli.ts produced its own
    // "Dashboard server" output (running OR not running).
    const result = spawnSync(process.execPath, [wrapperPath, "status"], {
      encoding: "utf-8",
      timeout: 30_000,
    });

    expect(result.stderr).not.toContain("cannot find the native TypeScript loader");
    expect(result.stdout).toMatch(/Dashboard server/i);
  }, 60_000);

  // The wrapper re-stamps NODE_OPTIONS for the server child. It must leave a
  // quoted operator value byte-for-byte: a split/join collapses the repeated
  // spaces below and the child can no longer find the --require'd file.
  // See change: guard-server-heap-and-store-coupling (CodeRabbit PR #780 sweep).
  it("preserves a quoted NODE_OPTIONS value with repeated spaces for the server child", () => {
    if (!existsSync(repoNativeRegister)) return;
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
 * Neither jiti nor tsx is resolvable from it. The stub `cli.ts` prints the child's
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
      `const out: string = JSON.stringify({ execArgv: process.execArgv, argv: process.argv.slice(1), loaderEnv: process.env.PI_DASHBOARD_TS_LOADER ?? null });\nconsole.log("CHILD " + out);\n`,
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

  function childArgv(stdout: string): { execArgv: string[]; argv: string[]; loaderEnv: string | null } {
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

  // E15 — the wrapper passes `cliPath` raw for both loaders; that mirror holds
  // only while `shouldUrlWrapEntry` is false for native AND jiti on every OS.
  // (design D8, revised: Node path.resolve()s the main entry, so a file://
  // entry breaks every Windows launch — win32 CI run 37347903583.)
  it("E15: shouldUrlWrapEntry agrees with the wrapper's raw entry in all 4 cells", () => {
    const loaders = {
      native: "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs",
      jiti: "file:///x/node_modules/jiti/lib/jiti-register.mjs",
    } as const;
    for (const platform of ["win32", "linux"] as const) {
      for (const kind of ["native", "jiti"] as const) {
        expect(shouldUrlWrapEntry(loaders[kind], platform), `${kind}/${platform}`).toBe(false);
      }
    }
    expect(readFileSync(wrapperPath, "utf-8")).toMatch(/^const entry = cliPath;$/m);
  });

  // #E14: PI_DASHBOARD_TS_LOADER is ignored by the wrapper — no warning (only the
  // server process warns) and the variable reaches the child unchanged.
  it.each([[undefined], [""], ["native"], ["jiti"], ["tsx"], ["garbage"]])(
    "E14/E16: PI_DASHBOARD_TS_LOADER=%s → native loader, no wrapper warning, env passed through",
    (loaderEnv) => {
      const tmp = fakeInstall();
      const res = runWrapper(tmp, ["start"], loaderEnv);
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      const child = childArgv(res.stdout);
      expect(child.execArgv[child.execArgv.indexOf("--import") + 1]).toMatch(/\/platform\/native-ts-register\.mjs$/);
      expect(child.argv.slice(1)).toEqual(["start"]);
      expect(child.loaderEnv).toBe(loaderEnv ?? null);
    },
    60_000,
  );

  it("E21: --version never needs a loader", () => {
    const tmp = fakeInstall();
    const v = runWrapper(tmp, ["--version"]);
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toBe("9.9.9");
  }, 60_000);
});
