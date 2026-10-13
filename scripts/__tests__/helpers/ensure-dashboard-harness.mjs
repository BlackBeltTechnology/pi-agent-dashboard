/**
 * Shared harness for the ensure-dashboard.sh tests (test-plan "Harness conventions").
 *
 * `makeCtx()` builds an isolated sandbox: a temp HOME holding the instance
 * records, a stub PATH directory whose executables log argv + environment to
 * one file, Node fixture servers (separate processes) and live/dead pid helpers.
 * `ctx.run(args, env)` runs the script asynchronously (the fixtures live in
 * other processes, but the test still must not block its own event loop).
 *
 * See change: add-claude-code-plugin.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const SCRIPT = path.join(
  REPO_ROOT,
  "packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh",
);
const FIXTURE_JS = path.join(HERE, "fixture-dashboard-server.mjs");
const REAL_CURL = execFileSync("sh", ["-c", "command -v curl"], { encoding: "utf8" }).trim();

export const PKG = "@blackbelt-technology/pi-agent-dashboard@latest";

/** Timing windows shortened for tests (the real values are 10/10/60/60/170 s). */
export const FAST = {
  PIDB_TEST_REFUSAL_S: "0",
  PIDB_TEST_RECORD_POLL_S: "1",
  PIDB_TEST_LIVE_POLL_S: "3",
  PIDB_TEST_READY_S: "5",
  PIDB_TEST_LOCK_WAIT_S: "4",
};

/** CLI-shaped stub: logs, prints to stdout, optionally boots a fixture dashboard. */
const cliStub = (label) => `#!/bin/sh
printf '${label}\\t%s\\t%s\\t%s\\n' "$*" "\${npm_config_allow_remote:-}" "$HOME" >> "$STUB_LOG"
echo "Dashboard server started (stub ${label})"
[ -n "\${STUB_CLI_EXIT:-}" ] && [ "$STUB_CLI_EXIT" != 0 ] && exit "$STUB_CLI_EXIT"
if [ "\${STUB_NO_BOOT:-}" != 1 ]; then
  port=""; prev=""
  for a in "$@"; do [ "$prev" = --port ] && port=$a; prev=$a; done
  [ -z "$port" ] && port=\${STUB_BOOT_PORT:-}
  if [ -n "$port" ]; then
    "$STUB_NODE" "$STUB_FIXTURE_JS" --mode dashboard --port "$port" --delay-ms "\${STUB_BOOT_DELAY_MS:-0}" \\
      --write-meta "$HOME/.pi/dashboard/server.lock.meta.json" --track "$STUB_TRACK_DIR" >/dev/null 2>&1 &
  fi
fi
exit 0
`;

const NPM_STUB = `#!/bin/sh
printf 'npm\\t%s\\t%s\\t%s\\n' "$*" "\${npm_config_allow_remote:-}" "$HOME" >> "$STUB_LOG"
case "$1" in
  prefix) echo "$STUB_NPM_PREFIX"; exit 0 ;;
  install)
    if [ "\${STUB_NPM_INSTALL_EXIT:-0}" != 0 ]; then echo "npm ERR! EACCES: permission denied" >&2; exit "$STUB_NPM_INSTALL_EXIT"; fi
    pkgdir="$STUB_NPM_PREFIX/lib/node_modules/@blackbelt-technology/pi-agent-dashboard"
    mkdir -p "$STUB_NPM_PREFIX/bin" "$pkgdir"
    cp "$STUB_CLI_TEMPLATE" "$STUB_NPM_PREFIX/bin/pi-dashboard"; chmod +x "$STUB_NPM_PREFIX/bin/pi-dashboard"
    printf '{"name":"@blackbelt-technology/pi-agent-dashboard","version":"%s"}\\n' "\${STUB_NPM_VERSION:-0.9.0}" > "$pkgdir/package.json"
    exit 0 ;;
  exec) exit "\${STUB_NPM_EXEC_EXIT:-0}" ;;
esac
exit 0
`;

const NODE_STUB = `#!/bin/sh
printf 'node\\t%s\\t\\t%s\\n' "$*" "$HOME" >> "$STUB_LOG"
case "$1" in --version) echo "$STUB_NODE_VERSION" ;; esac
exit 0
`;

const OPEN_STUB = `#!/bin/sh
printf 'open\\t%s\\t\\t%s\\n' "$*" "$HOME" >> "$STUB_LOG"
[ "\${STUB_OPEN_EXIT:-0}" != 0 ] && exit "$STUB_OPEN_EXIT"
if [ "\${STUB_NO_BOOT:-}" != 1 ] && [ -n "\${STUB_BOOT_PORT:-}" ]; then
  "$STUB_NODE" "$STUB_FIXTURE_JS" --mode dashboard --port "$STUB_BOOT_PORT" --delay-ms "\${STUB_BOOT_DELAY_MS:-0}" \\
    --write-meta "$HOME/.pi/dashboard/server.lock.meta.json" --track "$STUB_TRACK_DIR" >/dev/null 2>&1 &
fi
exit 0
`;

const UNAME_STUB = `#!/bin/sh
echo "\${STUB_UNAME:-Linux}"
`;

const CURL_STUB = `#!/bin/sh
printf 'curl\\t%s\\t\\t%s\\n' "$*" "$HOME" >> "$STUB_LOG"
exec "${REAL_CURL}" "$@"
`;

const SHELL_STUB = `#!/bin/sh
printf 'shell\\t%s\\t\\t%s\\n' "$*" "$HOME" >> "$STUB_LOG"
[ -n "\${STUB_SHELL_OUTPUT:-}" ] && printf '%s\\n' "$STUB_SHELL_OUTPUT"
exit 0
`;

function write(file, content, mode = 0o755) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{cli?: boolean, npm?: boolean, node?: boolean, npx?: boolean}} [stubs]
 */
export function makeCtx(stubs = {}) {
  const opts = { cli: true, npm: true, node: true, npx: true, ...stubs };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pidb-"));
  const home = path.join(dir, "home");
  const stubDir = path.join(dir, "bin");
  const d = path.join(home, ".pi", "dashboard");
  const logFile = path.join(dir, "stub.log");
  const trackDir = path.join(dir, "track");
  const npmPrefix = path.join(dir, "npm-prefix");
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(npmPrefix, { recursive: true });
  fs.writeFileSync(logFile, "");

  const cliTemplate = path.join(dir, "cli-template.sh");
  write(cliTemplate, cliStub("global-cli"));
  if (opts.cli) write(path.join(stubDir, "pi-dashboard"), cliStub("pi-dashboard"));
  if (opts.npx) write(path.join(stubDir, "npx"), cliStub("npx"));
  if (opts.npm) write(path.join(stubDir, "npm"), NPM_STUB);
  if (opts.node) write(path.join(stubDir, "node"), NODE_STUB);
  write(path.join(stubDir, "open"), OPEN_STUB);
  write(path.join(stubDir, "uname"), UNAME_STUB);
  write(path.join(stubDir, "curl"), CURL_STUB);
  const shellStub = path.join(stubDir, "login-shell");
  write(shellStub, SHELL_STUB);

  const pids = [];
  const children = [];

  const ctx = {
    dir,
    home,
    d,
    stubDir,
    npmPrefix,
    metaFile: path.join(d, "server.lock.meta.json"),
    pidFile: path.join(d, "server.pid"),
    configFile: path.join(d, "config.json"),
    cliTemplate,
    shellStub,

    writeCliStub: (file, label) => write(file, cliStub(label)),

    writeConfig(value) {
      fs.writeFileSync(ctx.configFile, typeof value === "string" ? value : JSON.stringify(value));
    },
    writeMeta(value) {
      fs.writeFileSync(
        ctx.metaFile,
        typeof value === "string"
          ? value
          : JSON.stringify({
              ppid: 1,
              piPort: 0,
              startedAt: 1,
              identity: "t",
              version: "0.0.0",
              url: "",
              hostname: "t",
              ...value,
            }),
      );
    },
    writePid(n) {
      fs.writeFileSync(ctx.pidFile, `${n}\n`);
    },

    /** A live pid (sleep child). */
    livePid() {
      const c = spawn("sleep", ["600"], { stdio: "ignore" });
      children.push(c);
      return c.pid;
    },
    /** A dead pid (reaped child). */
    async deadPid() {
      const c = spawn("true", [], { stdio: "ignore" });
      await new Promise((r) => c.once("exit", r));
      return c.pid;
    },

    /** Start a fixture server process; resolves once it is listening (or, with a delay, immediately). */
    async fixture({ mode = "dashboard", port = 0, pid, delayMs = 0, writeMeta = false } = {}) {
      const args = [FIXTURE_JS, "--mode", mode, "--port", String(port), "--delay-ms", String(delayMs), "--track", trackDir];
      if (pid !== undefined) args.push("--pid", String(pid));
      if (writeMeta) args.push("--write-meta", ctx.metaFile);
      const c = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "ignore"] });
      children.push(c);
      if (delayMs > 0) return { port, proc: c, stop: () => c.kill("SIGKILL") };
      const line = await new Promise((resolve, reject) => {
        let buf = "";
        c.stdout.on("data", (b) => {
          buf += b;
          if (buf.includes("\n")) resolve(buf.split("\n")[0]);
        });
        c.once("exit", () => reject(new Error("fixture exited early")));
      });
      const info = JSON.parse(line);
      return {
        port: info.port,
        pid: info.pid,
        proc: c,
        stop: async () => {
          c.kill("SIGKILL");
          await new Promise((r) => c.once("exit", r));
        },
      };
    },

    /** Run the script. Resolves `{status, stdout, stderr, ms}`. */
    run(args = [], env = {}, { timeoutMs = 120_000 } = {}) {
      const fullEnv = {
        HOME: home,
        PATH: `${stubDir}:/usr/bin:/bin`,
        SHELL: shellStub,
        TMPDIR: dir,
        PIDB_TEST: "1",
        PIDB_TEST_NO_SYSTEM_DIRS: "1",
        ...FAST,
        STUB_LOG: logFile,
        STUB_NODE: process.execPath,
        STUB_FIXTURE_JS: FIXTURE_JS,
        STUB_TRACK_DIR: trackDir,
        STUB_CLI_TEMPLATE: cliTemplate,
        STUB_NPM_PREFIX: npmPrefix,
        STUB_NODE_VERSION: "v24.15.0",
        ...env,
      };
      for (const k of Object.keys(fullEnv)) if (fullEnv[k] === undefined) delete fullEnv[k];
      const started = Date.now();
      return new Promise((resolve) => {
        const c = spawn("sh", [SCRIPT, ...args], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        c.stdout.on("data", (b) => (stdout += b));
        c.stderr.on("data", (b) => (stderr += b));
        const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
        c.once("close", (status) => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr, ms: Date.now() - started });
        });
      });
    },

    /** Logged stub invocations: `{name, argv, allowRemote, home}`. */
    calls(name) {
      return fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [n, argv, allowRemote, h] = l.split("\t");
          return { name: n, argv, allowRemote, home: h };
        })
        .filter((c) => (name ? c.name === name : true));
    },
    /** Everything that would start or install a dashboard. */
    launches() {
      return ctx
        .calls()
        .filter(
          (c) =>
            (/^(pi-dashboard|global-cli|nvm-.*|login-shell-cli|npx-cache-.*)$/.test(c.name) && c.argv.startsWith("start")) ||
            c.name === "npx" ||
            c.name === "open" ||
            (c.name === "npm" && /^(install|exec)\b/.test(c.argv)),
        );
    },
    logSize: () => fs.readFileSync(logFile, "utf8").length,

    sleepMs,

    cleanup() {
      for (const c of children) {
        try {
          c.kill("SIGKILL");
        } catch {}
      }
      try {
        for (const f of fs.readdirSync(trackDir)) {
          try {
            process.kill(Number(fs.readFileSync(path.join(trackDir, f), "utf8")), "SIGKILL");
          } catch {}
        }
      } catch {}
      for (const p of pids) {
        try {
          process.kill(p, "SIGKILL");
        } catch {}
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return ctx;
}

/** The standard ready output: STATUS then BASE, nothing else. */
export const readyOut = (status, port) => `STATUS=${status}\nBASE=http://localhost:${port}\n`;
