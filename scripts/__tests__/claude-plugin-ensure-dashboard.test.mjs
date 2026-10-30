/**
 * Behaviour tests for the Claude plugin's bootstrap script `ensure-dashboard.sh`.
 *
 * Every test runs the real script (`sh`) against a temp HOME holding instance
 * records, a stub PATH whose executables log argv + environment, and Node
 * fixture servers (see helpers/ensure-dashboard-harness.mjs). Timing windows are
 * shortened through PIDB_TEST_* overrides; one test (X4) uses the real window.
 *
 * Scenario ids refer to openspec/changes/add-claude-code-plugin/test-plan.md.
 *
 * See change: add-claude-code-plugin.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUsableNodeVersion } from "../../packages/shared/src/node-version.ts";
import { freePort, makeCtx, PKG, readyOut, REPO_ROOT, SCRIPT } from "./helpers/ensure-dashboard-harness.mjs";

vi.setConfig({ testTimeout: 90_000 });

const ctxs = [];
/** Create a sandbox that is cleaned after the test. */
const sandbox = (stubs) => {
  const c = makeCtx(stubs);
  ctxs.push(c);
  return c;
};
afterEach(() => {
  for (const c of ctxs.splice(0)) c.cleanup();
});

const noLaunch = (ctx) => expect(ctx.launches()).toEqual([]);

/** A dashboard that is up: fixture + matching lock metadata. Returns `{port, fx}`. */
async function upDashboard(ctx, extra = {}) {
  const fx = await ctx.fixture({ mode: "dashboard", ...extra });
  ctx.writeMeta({ pid: fx.pid, httpPort: fx.port });
  return { port: fx.port, fx };
}

// ───────────────────────────── harness smoke (2.1) ─────────────────────────────

describe("harness smoke (task 2.1)", () => {
  it.each(["dashboard", "wrong-pid", "no-pid", "recovery", "foreign-html", "hung"])("starts and stops fixture %s", async (mode) => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode });
    expect(fx.port).toBeGreaterThan(0);
    await fx.stop();
  });

  it("refused: a freed port refuses connections", async () => {
    const port = await freePort();
    const r = spawnSync("curl", ["-s", "-m", "2", `http://127.0.0.1:${port}/`]);
    expect(r.status).toBe(7);
  });
});

// ───────────────────────── identity / already up (E3–E9) ─────────────────────────

describe("identity and already-running", () => {
  it("E3: verified dashboard → already-running, no launcher", async () => {
    const ctx = sandbox();
    const { port } = await upDashboard(ctx);
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe(readyOut("already-running", port));
    expect(r.status).toBe(0);
    noLaunch(ctx);
  });

  it("E4: ok body without a pid → port-conflict, exit 5", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "no-pid" });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port) });
    expect(r.stdout).toBe("STATUS=port-conflict\n");
    expect(r.status).toBe(5);
    noLaunch(ctx);
  });

  it("E5: pid that matches no record → port-conflict, exit 5", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "dashboard" });
    ctx.writeMeta({ pid: await ctx.deadPid(), httpPort: fx.port });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port), PIDB_TEST_RECORD_POLL_S: "1" });
    expect(r.stdout).toBe("STATUS=port-conflict\n");
    expect(r.status).toBe(5);
    noLaunch(ctx);
  });

  it("E6: the record catching up inside the poll → already-running", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "dashboard" });
    ctx.writeMeta({ pid: await ctx.deadPid(), httpPort: fx.port });
    setTimeout(() => ctx.writeMeta({ pid: fx.pid, httpPort: fx.port }), 500);
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port), PIDB_TEST_RECORD_POLL_S: "3" });
    expect(r.stdout).toBe(readyOut("already-running", fx.port));
    expect(r.status).toBe(0);
  });

  it("E7: recovery mode → recovery, exit 3", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "recovery" });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port) });
    expect(r.stdout).toBe("STATUS=recovery\n");
    expect(r.status).toBe(3);
    noLaunch(ctx);
  });

  it("E8: foreign HTML service → port-conflict, exit 5", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "foreign-html" });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port) });
    expect(r.stdout).toBe("STATUS=port-conflict\n");
    expect(r.status).toBe(5);
    noLaunch(ctx);
  });

  it("E9: a starting server is waited for, never started over; records untouched", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const live = ctx.livePid();
    ctx.writeMeta({ pid: live, httpPort: port });
    ctx.writePid(live);
    const metaBefore = fs.readFileSync(ctx.metaFile, "utf8");
    const pidBefore = fs.readFileSync(ctx.pidFile, "utf8");
    await ctx.fixture({ mode: "dashboard", port, pid: live, delayMs: 2000 });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), PIDB_TEST_LIVE_POLL_S: "20" });
    expect(r.stdout).toBe(readyOut("already-running", port));
    noLaunch(ctx);
    expect(fs.readFileSync(ctx.metaFile, "utf8")).toBe(metaBefore);
    expect(fs.readFileSync(ctx.pidFile, "utf8")).toBe(pidBefore);
  });
});

// ───────────────────────────── port resolution (E10–E13) ─────────────────────────────

describe("port resolution", () => {
  it.each(["abc", "0", "65536", "70000", "1e4", " 18555 "])("E10: unusable DASHBOARD_PORT %j is ignored", async (value) => {
    const ctx = sandbox();
    const { port } = await upDashboard(ctx);
    ctx.writeConfig({ port });
    const r = await ctx.run([], { DASHBOARD_PORT: value });
    expect(r.stdout).toBe(readyOut("already-running", port));
  });

  it.each(["1", "65535"])("E11: DASHBOARD_PORT=%s is used (boundary)", async (value) => {
    const ctx = sandbox();
    const r = await ctx.run(["--check"], { DASHBOARD_PORT: value });
    expect(r.status).not.toBe(0);
    const urls = ctx.calls("curl").map((c) => c.argv);
    expect(urls.some((a) => a.includes(`http://localhost:${value}/api/health`))).toBe(true);
  });

  it.each([
    [{ PI_DASHBOARD_PORT: "18001", DASHBOARD_PORT: "18002" }, 18003, 18001],
    [{ DASHBOARD_PORT: "18002" }, 18003, 18002],
    [{}, 18003, 18003],
    [{}, null, 8000],
  ])("E12: precedence %j config=%s → %s", async (env, configPort, expected) => {
    const ctx = sandbox();
    if (configPort) ctx.writeConfig({ port: configPort });
    await ctx.run(["--check"], env);
    const urls = ctx.calls("curl").map((c) => c.argv);
    expect(urls.some((a) => a.includes(`http://localhost:${expected}/api/health`))).toBe(true);
    expect(urls.some((a) => !a.includes(`:${expected}/`))).toBe(false);
  });

  it("E13: a nested port before the top-level port is ignored", async () => {
    const ctx = sandbox();
    const { port } = await upDashboard(ctx);
    ctx.writeConfig(`{"tunnel":{"port":9,"nested":{"port":10}},"name":"x","port":${port}}`);
    const r = await ctx.run([]);
    expect(r.stdout).toBe(readyOut("already-running", port));
  });
});

// ───────────────────────── launching: argv, protocol, other port (E14–E17) ─────────────────────────

describe("launch contract", () => {
  it("E14: launches `start --port <resolved>` with the caller's HOME", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.status, r.stderr).toBe(0);
    const calls = ctx.calls("pi-dashboard");
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toBe(`start --port ${port}`);
    expect(calls[0].home).toBe(ctx.home);
  });

  it("E15: launcher stdout goes to stderr; stdout carries only the protocol lines", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe(readyOut("started", port));
    expect(r.stderr).toContain("Dashboard server started");
  });

  it("E16: config-sourced port refuses, instance on another port → already-running there", async () => {
    const ctx = sandbox();
    const configPort = await freePort();
    const live = ctx.livePid();
    const fx = await ctx.fixture({ mode: "dashboard", pid: live });
    ctx.writeMeta({ pid: live, httpPort: fx.port });
    ctx.writeConfig({ port: configPort });
    const r = await ctx.run([]);
    expect(r.stdout).toBe(readyOut("already-running", fx.port));
    noLaunch(ctx);
  });

  it("E17: env-sourced port while the instance runs elsewhere → failed naming that port", async () => {
    const ctx = sandbox();
    const asked = await freePort();
    const live = ctx.livePid();
    const fx = await ctx.fixture({ mode: "dashboard", pid: live });
    ctx.writeMeta({ pid: live, httpPort: fx.port });
    const r = await ctx.run([], { DASHBOARD_PORT: String(asked) });
    expect(r.stdout).toBe("STATUS=failed\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(String(fx.port));
    noLaunch(ctx);
  });
});

// ───────────────────────────── launch-source order (E18–E23) ─────────────────────────────

describe("launch sources", () => {
  it("E18: the highest-versioned nvm Node's CLI is used", async () => {
    const ctx = sandbox({ cli: false });
    for (const v of ["v9.0.0", "v22.19.0", "v24.15.0"]) {
      ctx.writeCliStub(path.join(ctx.home, ".nvm/versions/node", v, "bin/pi-dashboard"), `nvm-${v}`);
    }
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.status, r.stderr).toBe(0);
    expect(ctx.launches().map((c) => c.name)).toEqual(["nvm-v24.15.0"]);
  });

  it("E19: a non-interactive login shell finds the CLI; noise lines are never executed", async () => {
    const ctx = sandbox({ cli: false });
    const real = path.join(ctx.dir, "y/bin/pi-dashboard");
    ctx.writeCliStub(real, "login-shell-cli");
    const port = await freePort();
    const r = await ctx.run([], {
      PI_DASHBOARD_PORT: String(port),
      STUB_SHELL_OUTPUT: `Last login: today\n/x/not-it\n${real}`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(ctx.launches().map((c) => c.name)).toEqual(["login-shell-cli"]);
    const shell = ctx.calls("shell");
    expect(shell.length).toBeGreaterThan(0);
    expect(shell[0].argv.split(" ")).toContain("-lc");
    expect(shell[0].argv.split(" ")).not.toContain("-i");
  });

  it("E20: the newest non-prerelease npx-cache copy is used, reported non-durable", async () => {
    const ctx = sandbox({ cli: false });
    const mk = (hash, version, label, mtime) => {
      const base = path.join(ctx.home, ".npm/_npx", hash, "node_modules");
      const bin = path.join(base, ".bin/pi-dashboard");
      ctx.writeCliStub(bin, label);
      fs.mkdirSync(path.join(base, "@blackbelt-technology/pi-agent-dashboard"), { recursive: true });
      fs.writeFileSync(
        path.join(base, "@blackbelt-technology/pi-agent-dashboard/package.json"),
        JSON.stringify({ name: "@blackbelt-technology/pi-agent-dashboard", version }),
      );
      fs.utimesSync(bin, mtime, mtime);
    };
    mk("aaa", "0.9.0", "npx-cache-0.9.0", new Date(Date.now() - 3_600_000));
    mk("bbb", "0.0.0-test-x", "npx-cache-test", new Date());
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.status, r.stderr).toBe(0);
    expect(ctx.launches().map((c) => c.name)).toEqual(["npx-cache-0.9.0"]);
    expect(r.stderr).toContain("non-durable");
  });

  it("E21: macOS app is opened in the background when no CLI exists (port from config)", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    ctx.writeConfig({ port });
    const r = await ctx.run([], { STUB_UNAME: "Darwin", STUB_BOOT_PORT: String(port), STUB_BOOT_DELAY_MS: "500" });
    expect(r.stdout).toBe(readyOut("started", port));
    const open = ctx.calls("open");
    expect(open).toHaveLength(1);
    expect(open[0].argv).toBe("-g -b com.blackbelt-technology.pi-dashboard");
  });

  it("E22: open is skipped on Linux, and on macOS when the port is env-sourced", async () => {
    const linux = sandbox({ cli: false });
    const p1 = await freePort();
    linux.writeConfig({ port: p1 });
    const r1 = await linux.run([], { STUB_UNAME: "Linux" });
    expect(r1.stdout).toBe("STATUS=not-installed\n");
    expect(linux.calls("open")).toEqual([]);

    const mac = sandbox({ cli: false });
    const p2 = await freePort();
    const r2 = await mac.run([], { STUB_UNAME: "Darwin", DASHBOARD_PORT: String(p2) });
    expect(r2.stdout).toBe("STATUS=not-installed\n");
    expect(mac.calls("open")).toEqual([]);
  });

  it("E23: no CLI, no app, no consent → not-installed, exit 4, nothing downloaded", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe("STATUS=not-installed\n");
    expect(r.status).toBe(4);
    noLaunch(ctx);
    expect(r.stderr).toContain(`npm install -g ${PKG}`);
  });
});

// ───────────────────────────── consented install (E24–E27) ─────────────────────────────

describe("consented install", () => {
  it("E24: global install with the override on npm only; the CLI starts without it", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    const r = await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`STATUS=started\nBASE=http://localhost:${port}\nINSTALL=global\n`);
    const install = ctx.calls("npm").find((c) => c.argv.startsWith("install"));
    expect(install.argv).toBe(`install -g ${PKG}`);
    expect(install.allowRemote).toBe("all");
    const cli = ctx.calls("global-cli");
    expect(cli).toHaveLength(1);
    expect(cli[0].argv).toBe(`start --port ${port}`);
    expect(cli[0].allowRemote).toBe("");
    expect(ctx.calls("npx")).toEqual([]);
  });

  it("E24b: a caller-exported npm_config_allow_remote never reaches the started server", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port), npm_config_allow_remote: "all" });
    expect(ctx.calls("global-cli")[0].allowRemote).toBe("");
  });

  it("E25: a prerelease version is refused; the CLI is never started", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    const r = await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port), STUB_NPM_VERSION: "0.10.0-rc.1" });
    expect(r.stdout).toBe("STATUS=failed\n");
    expect(r.status).toBe(1);
    expect(ctx.calls("global-cli")).toEqual([]);
  });

  const NODE_TABLE = [
    ["v20.11.0", false],
    ["v22.18.0", false],
    ["v22.19.0", true],
    ["v24.0.0", true],
    ["v24.2.0", false],
    ["v24.3.0", true],
    ["v26.9.0", true],
    ["v27.0.0", false],
  ];
  it.each(NODE_TABLE)("E26: Node %s → usable=%s (and equals the shared gate)", async (version, usable) => {
    expect(isUsableNodeVersion(version)).toBe(usable);
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    const r = await ctx.run(["--install"], {
      PI_DASHBOARD_PORT: String(port),
      STUB_NODE_VERSION: version,
      STUB_NO_BOOT: "1",
      PIDB_TEST_READY_S: "1",
    });
    const ranNpm = ctx.launches().some((c) => c.name === "npm");
    expect(ranNpm).toBe(usable);
    if (!usable) {
      expect(r.stdout).toBe("STATUS=failed\n");
      expect(r.status).toBe(1);
    }
  });

  describe("E27: the script's Node range tracks package.json engines and the shared gate", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const num = (name) => Number(src.match(new RegExp(`^${name}=(\\d+)$`, "m"))[1]);
    const engines = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).engines.node;

    it("constants equal engines.node", () => {
      const m = engines.match(/^>=(\d+)\.(\d+)\.\d+ <(\d+)$/);
      expect(m, `engines.node ${engines}`).toBeTruthy();
      expect(num("NODE_MIN_MAJOR")).toBe(Number(m[1]));
      expect(num("NODE_MIN_MINOR")).toBe(Number(m[2]));
      expect(num("NODE_CAP_MAJOR")).toBe(Number(m[3]));
    });

    it("node_usable decides like isUsableNodeVersion for a version grid", () => {
      const consts = src.match(/^NODE_[A-Z_0-9]+=\d+$/gm).join("\n");
      const fnStart = src.indexOf("node_usable() {");
      const fn = src.slice(fnStart, src.indexOf("\n}\n", fnStart) + 3);
      const disagreements = [];
      for (const major of [18, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
        for (const minor of [0, 1, 2, 3, 18, 19, 20]) {
          const v = `v${major}.${minor}.0`;
          const r = spawnSync("sh", ["-c", `${consts}\n${fn}\nnode_usable ${v} && echo yes || echo no`], { encoding: "utf8" });
          if ((r.stdout.trim() === "yes") !== isUsableNodeVersion(v)) disagreements.push(v);
        }
      }
      expect(disagreements).toEqual([]);
    });
  });
});

// ───────────────────────────── sandbox + check (E28–E30) ─────────────────────────────

describe("sandbox refusal and --check", () => {
  it.each([
    [{ CLAUDE_CODE_IS_COWORK: "1" }],
    [{ CLAUDE_CODE_REMOTE: "1" }],
    [{ CLAUDE_CONFIG_DIR: "/sessions/x/mnt/.claude" }],
  ])("E28: %j → sandbox, exit 2, no activity", async (env) => {
    const ctx = sandbox();
    const r = await ctx.run([], env);
    expect(r.stdout).toBe("STATUS=sandbox\n");
    expect(r.status).toBe(2);
    expect(ctx.logSize()).toBe(0);
    expect(fs.readdirSync(ctx.d).filter((f) => f.endsWith(".lock"))).toEqual([]);
  });

  it("E29: local Claude Code markers do not trigger the sandbox refusal", async () => {
    const ctx = sandbox();
    const { port } = await upDashboard(ctx);
    const r = await ctx.run([], {
      PI_DASHBOARD_PORT: String(port),
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SESSION_ID: "x",
    });
    expect(r.stdout).toBe(readyOut("already-running", port));
  });

  it("E30: --check succeeds only for a verified dashboard; never locks or launches", async () => {
    const ok = sandbox();
    const { port } = await upDashboard(ok);
    const r1 = await ok.run(["--check"], { PI_DASHBOARD_PORT: String(port) });
    expect(r1.status).toBe(0);
    expect(r1.stdout).toBe(readyOut("already-running", port));

    const refused = sandbox();
    const r2 = await refused.run(["--check"], { PI_DASHBOARD_PORT: String(await freePort()) });
    expect(r2.status).not.toBe(0);

    const wrong = sandbox();
    const fx = await wrong.fixture({ mode: "wrong-pid" });
    const r3 = await wrong.run(["--check"], { PI_DASHBOARD_PORT: String(fx.port) });
    expect(r3.status).not.toBe(0);

    for (const c of [ok, refused, wrong]) {
      noLaunch(c);
      expect(fs.readdirSync(c.d).filter((f) => f.endsWith(".lock"))).toEqual([]);
    }
  });
});

// ───────────────────────────── bootstrap lock (E31–E34) ─────────────────────────────

describe("bootstrap lock", () => {
  const lockDir = (ctx, port) => path.join(ctx.d, `claude-bootstrap-${port}.lock`);

  it("E31: a lock whose holder is dead is reclaimed; one launch; lock gone afterwards", async () => {
    const ctx = sandbox();
    const port = await freePort();
    fs.mkdirSync(lockDir(ctx, port));
    fs.writeFileSync(path.join(lockDir(ctx, port), "holder"), `${await ctx.deadPid()}\n`);
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe(readyOut("started", port));
    expect(ctx.calls("pi-dashboard")).toHaveLength(1);
    expect(fs.existsSync(lockDir(ctx, port))).toBe(false);
  });

  it("E32: a fresh holder-less lock counts as live → busy, lock untouched", async () => {
    const ctx = sandbox();
    const port = await freePort();
    fs.mkdirSync(lockDir(ctx, port));
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), PIDB_TEST_LOCK_WAIT_S: "3" });
    expect(r.stdout).toBe("STATUS=busy\n");
    expect(r.status).toBe(3);
    noLaunch(ctx);
    expect(fs.existsSync(lockDir(ctx, port))).toBe(true);
    expect(fs.readdirSync(lockDir(ctx, port))).toEqual([]);
  });

  it("E32b: a fresh lock whose holder file is still empty (mid-write) counts as live → busy, lock untouched", async () => {
    const ctx = sandbox();
    const port = await freePort();
    fs.mkdirSync(lockDir(ctx, port));
    fs.writeFileSync(path.join(lockDir(ctx, port), "holder"), "");
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), PIDB_TEST_LOCK_WAIT_S: "3" });
    expect(r.stdout).toBe("STATUS=busy\n");
    expect(r.status).toBe(3);
    noLaunch(ctx);
    expect(fs.readdirSync(lockDir(ctx, port))).toEqual(["holder"]);
  });

  it("E33: a holder-less lock older than a minute is reclaimed", async () => {
    const ctx = sandbox();
    const port = await freePort();
    fs.mkdirSync(lockDir(ctx, port));
    const past = new Date(Date.now() - 120_000);
    fs.utimesSync(lockDir(ctx, port), past, past);
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe(readyOut("started", port));
    expect(ctx.calls("pi-dashboard")).toHaveLength(1);
  });

  it("E34: the script never removes recursively and guards every HOME-derived path", () => {
    const code = fs
      .readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"));
    expect(code.filter((l) => /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR]/.test(l))).toEqual([]);
    expect(code.filter((l) => /\$HOME\b|\$\{HOME(?!:\?)/.test(l))).toEqual([]);
  });
});

// ───────────────────────────── latency (P1) ─────────────────────────────

describe("latency", () => {
  it("P1: an up dashboard is reported (script and --check) within 5 s", async () => {
    const ctx = sandbox();
    const { port } = await upDashboard(ctx);
    const times = [];
    for (let i = 0; i < 5; i++) {
      times.push((await ctx.run([], { PI_DASHBOARD_PORT: String(port) })).ms);
      times.push((await ctx.run(["--check"], { PI_DASHBOARD_PORT: String(port) })).ms);
    }
    expect(Math.max(...times)).toBeLessThanOrEqual(5000);
  });
});

// ───────────────────────────── error handling (X1–X10) ─────────────────────────────

describe("error handling", () => {
  it("X1: a hung server → busy, log path, records untouched, no launcher", async () => {
    const ctx = sandbox();
    const fx = await ctx.fixture({ mode: "hung" });
    ctx.writeMeta({ pid: ctx.livePid(), httpPort: fx.port });
    ctx.writePid(ctx.livePid());
    const before = [fs.readFileSync(ctx.metaFile, "utf8"), fs.readFileSync(ctx.pidFile, "utf8")];
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(fx.port) });
    expect(r.stdout).toBe("STATUS=busy\n");
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("server.log");
    noLaunch(ctx);
    expect([fs.readFileSync(ctx.metaFile, "utf8"), fs.readFileSync(ctx.pidFile, "utf8")]).toEqual(before);
  });

  it("X2: a live recorded pid that never answers → busy, no launcher", async () => {
    const ctx = sandbox();
    const port = await freePort();
    ctx.writeMeta({ pid: ctx.livePid(), httpPort: port });
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), PIDB_TEST_LIVE_POLL_S: "2" });
    expect(r.stdout).toBe("STATUS=busy\n");
    expect(r.status).toBe(3);
    noLaunch(ctx);
  });

  it("X3: corrupt metadata counts as unknown → busy, no launcher", async () => {
    const ctx = sandbox();
    const port = await freePort();
    ctx.writeMeta('{"pid":');
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), PIDB_TEST_LIVE_POLL_S: "2" });
    expect(r.stdout).toBe("STATUS=busy\n");
    expect(r.status).toBe(3);
    noLaunch(ctx);
  });

  it("X4: the real 10 s refusal window rides out a transient refusal", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const live = ctx.livePid();
    await ctx.fixture({ mode: "dashboard", port, pid: live, delayMs: 3000, writeMeta: true });
    const r = await ctx.run([], {
      PI_DASHBOARD_PORT: String(port),
      PIDB_TEST_REFUSAL_S: undefined,
      PIDB_TEST_LIVE_POLL_S: "20",
    });
    expect(r.stdout).toBe(readyOut("already-running", port));
    noLaunch(ctx);
  });

  it("X5: two concurrent bootstraps launch exactly once", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const env = { PI_DASHBOARD_PORT: String(port), STUB_BOOT_DELAY_MS: "2000", PIDB_TEST_READY_S: "15", PIDB_TEST_LOCK_WAIT_S: "20" };
    const [a, b] = await Promise.all([ctx.run([], env), ctx.run([], env)]);
    // Intermittent in full-suite CI only (not reproducible locally): on failure, carry both runs'
    // output and the stub call log so the race path can be read from the CI log.
    const trace = () =>
      ["== A", `status=${a.status} ms=${a.ms}`, a.stdout, a.stderr, "== B", `status=${b.status} ms=${b.ms}`, b.stdout, b.stderr, "== stub log", ...ctx.calls().map((c) => `${c.name}\t${c.argv}`)].join("\n");
    expect(ctx.calls("pi-dashboard"), trace()).toHaveLength(1);
    expect([a.stdout, b.stdout].map((s) => s.split("\n")[0]).sort()).toEqual(["STATUS=already-running", "STATUS=started"]);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
  });

  it("X6: a failing launcher → failed, no later source tried", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const r = await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port), STUB_CLI_EXIT: "1", STUB_UNAME: "Darwin" });
    expect(r.stdout).toBe("STATUS=failed\n");
    expect(r.status).toBe(1);
    expect(ctx.calls("npx")).toEqual([]);
    expect(ctx.calls("open")).toEqual([]);
    expect(ctx.calls("npm").filter((c) => !c.argv.startsWith("prefix"))).toEqual([]);
  });

  it("X7: a launcher that exits 0 but never serves → failed after the readiness window, log path", async () => {
    const ctx = sandbox();
    const port = await freePort();
    const r = await ctx.run([], { PI_DASHBOARD_PORT: String(port), STUB_NO_BOOT: "1", PIDB_TEST_READY_S: "2" });
    expect(r.stdout).toBe("STATUS=failed\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("server.log");
  });

  it("X8: failed global install → prefix hint, npm exec with the override, npx start without it", async () => {
    const ctx = sandbox({ cli: false });
    const port = await freePort();
    const r = await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port), STUB_NPM_INSTALL_EXIT: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`STATUS=started\nBASE=http://localhost:${port}\nINSTALL=npx-cache\n`);
    expect(r.stderr).toContain("npm config set prefix");
    expect(r.stderr).not.toMatch(/sudo/i);
    expect(r.stderr).toContain("non-durable");
    const exec = ctx.calls("npm").find((c) => c.argv.startsWith("exec"));
    expect(exec.argv).toBe(`exec --yes --package=${PKG} -- node -e 0`);
    expect(exec.allowRemote).toBe("all");
    const npx = ctx.calls("npx");
    expect(npx).toHaveLength(1);
    expect(npx[0].argv).toBe(`--yes ${PKG} start --port ${port}`);
    expect(npx[0].allowRemote).toBe("");
  });

  it("X9: --install without a resolvable npm → failed, nothing downloaded", async () => {
    const ctx = sandbox({ cli: false, npm: false });
    const port = await freePort();
    const r = await ctx.run(["--install"], { PI_DASHBOARD_PORT: String(port) });
    expect(r.stdout).toBe("STATUS=failed\n");
    expect(r.status).toBe(1);
    noLaunch(ctx);
  });

  it("X10: a port re-bound by another process fails --check with port-conflict", async () => {
    const ctx = sandbox();
    const first = await upDashboard(ctx);
    const ok = await ctx.run([], { PI_DASHBOARD_PORT: String(first.port) });
    expect(ok.stdout).toBe(readyOut("already-running", first.port));
    await first.fx.stop();
    await ctx.fixture({ mode: "wrong-pid", port: first.port });
    const r = await ctx.run(["--check"], { PI_DASHBOARD_PORT: String(first.port), PIDB_TEST_RECORD_POLL_S: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("STATUS=port-conflict\n");
  });
});

