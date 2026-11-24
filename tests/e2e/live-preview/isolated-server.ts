import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { httpProofHeaders } from "../../../packages/shared/src/local-credential-proof.ts";

/**
 * Host-run ISOLATED dashboard server for the live-preview L3 suite
 * (`playwright.live-preview.config.ts`). NOT the docker harness: the server runs on the host
 * with `HOME=<tmp>` on a free non-8000 port, so a browser on the host is a REAL loopback peer
 * and tier 1 (`<label>.localhost`) applies. It never touches ~/.pi or the live :8000 server.
 * See change: serve-live-previews-on-capability-origin (tasks 14.2, 14.4; test-plan Q1).
 *
 * This module is shared by `global-setup.ts` / `global-teardown.ts` (start/stop once per run)
 * and by `fixture.ts` (`isolatedServer` worker fixture: restart with a config patch, log grep).
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Run state (port, pid, home, …) written by global-setup, read by every worker. */
const STATE_PATH = process.env.PI_LP_STATE ?? path.join(os.tmpdir(), "pi-live-preview-e2e.json");

export interface ServerState {
  /** Dashboard HTTP port (free, never 8000). */
  port: number;
  /** Pi gateway port id (the bridge socket is `<home>/.pi/dashboard/gateway-<piPort>.sock`). */
  piPort: number;
  /** Tier-3 pool range (inclusive) written into `liveServer.previewOrigins.portPool`. */
  pool: { from: number; to: number };
  /** Temp HOME of the server (config at `<home>/.pi/dashboard/config.json`). */
  home: string;
  /** Server stdout+stderr (append-only; one file for the whole run, restarts included). */
  log: string;
  /** Node binary running the server (the server refuses Node outside its engines range). */
  nodeBin: string;
  pid: number;
  /** Extra environment for the server process (e.g. `PI_DASHBOARD_CSP`), set via `restart({ env })`. */
  extraEnv?: Record<string, string>;
}

export const readState = (): ServerState => JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as ServerState;
const writeState = (s: ServerState): void => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

/** Hostnames the `chromium-resolver` project maps to 127.0.0.1 (see the config's launch args). */
const RESOLVER_HOSTS = { tier2Dash: "dash.test", tier5Dash: "dash5.test", previewSuffix: "preview.test" } as const;

/** The base config every run starts from (and `restart({reset:true})` returns to). */
function baseConfig(s: Pick<ServerState, "port" | "piPort" | "pool">): Record<string, unknown> {
  return {
    port: s.port,
    piPort: s.piPort,
    autoShutdown: false,
    // Host gate: the resolver-project dashboard hosts are admitted explicitly.
    allowedHosts: [RESOLVER_HOSTS.tier2Dash, RESOLVER_HOSTS.tier5Dash],
    liveServer: {
      previewOrigins: {
        enabled: true,
        // tier 2: `<label>.preview.test` for dashboards reached as dash.test only (dash5.test → tier 5).
        // `port` = the dashboard port: the resolver maps *.preview.test to 127.0.0.1, where only the dashboard listens.
        wildcard: { suffix: RESOLVER_HOSTS.previewSuffix, scheme: "http", forHosts: [RESOLVER_HOSTS.tier2Dash], port: s.port },
        // tier 3: a loopback pool range (one listener per port).
        portPool: `${s.pool.from}-${s.pool.to}`,
      },
    },
  };
}

const canBind = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

/** `size` contiguous free ports (random start in 30000–50000 so concurrent runs rarely collide). */
async function freePortRange(size: number): Promise<{ from: number; to: number }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const from = 30_000 + Math.floor(Math.random() * 20_000);
    let ok = true;
    for (let p = from; p < from + size; p++) {
      if (!(await canBind(p))) {
        ok = false;
        break;
      }
    }
    if (ok) return { from, to: from + size - 1 };
  }
  throw new Error(`no ${size}-port free range found`);
}

/**
 * Node binary for the server. The server's start guard only accepts the Node 26 engines range, but
 * the Playwright runner may be Node 24: use `PI_LP_NODE`, else the current binary when it is ≥ 26,
 * else the newest `~/.nvm/versions/node/v26*`, else `node` on PATH if it is ≥ 26.
 */
function resolveServerNode(): string {
  const major = (v: string) => Number(/^v?(\d+)/.exec(v)?.[1] ?? 0);
  if (process.env.PI_LP_NODE) return process.env.PI_LP_NODE;
  if (major(process.version) >= 26) return process.execPath;
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  if (fs.existsSync(nvm)) {
    const v26 = fs.readdirSync(nvm).filter((d) => major(d) >= 26).sort();
    const pick = v26.at(-1);
    if (pick) return path.join(nvm, pick, "bin", "node");
  }
  throw new Error("live-preview e2e: the dashboard server needs Node >= 26 and none was found; set PI_LP_NODE=/path/to/node26");
}

const NATIVE_TS_REGISTER_URL = pathToFileURL(path.join(REPO_ROOT, "packages/shared/src/platform/native-ts-register.mjs")).href;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(port: number, child: ChildProcess | null, log: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`isolated dashboard exited (${child.exitCode}); see ${log}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`isolated dashboard not healthy within ${timeoutMs / 1000}s; see ${log}`);
}

function spawnServer(s: Omit<ServerState, "pid">): ChildProcess {
  const fd = fs.openSync(s.log, "a");
  // Drop inherited PI_* (a run launched from inside a pi session would otherwise point the isolated
  // server's children at the DEVELOPER's dashboard).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_"))) as NodeJS.ProcessEnv;
  const child = spawn(
    s.nodeBin,
    ["--import", NATIVE_TS_REGISTER_URL, "packages/server/src/cli.ts", "--port", String(s.port), "--no-tunnel"],
    { cwd: REPO_ROOT, env: { ...env, ...s.extraEnv, HOME: s.home }, stdio: ["ignore", fd, fd], detached: true },
  );
  child.unref();
  return child;
}

/** Create the temp HOME + config, start the server, wait healthy, record the run state. */
export async function startIsolatedServer(persist = true): Promise<ServerState> {
  if (!fs.existsSync(path.join(REPO_ROOT, "packages/client/dist/index.html"))) {
    throw new Error("live-preview e2e: packages/client/dist is missing — run `npm run build` first");
  }
  const port = await freePort();
  const piPort = await freePort();
  const pool = await freePortRange(20);
  // Short base dir: the pi gateway Unix socket lives under HOME and macOS caps socket paths at ~104 bytes.
  const home = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "pi-lp-"));
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(baseConfig({ port, piPort, pool }), null, 2));
  const log = path.join(home, "server.log");
  const base = { port, piPort, pool, home, log, nodeBin: resolveServerNode() };
  const child = spawnServer(base);
  const state: ServerState = { ...base, pid: child.pid as number };
  if (persist) writeState(state);
  try {
    await waitHealthy(port, child, log);
  } catch (err) {
    killPid(state.pid);
    throw err;
  }
  return state;
}

export function killPid(pid: number): void {
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-pid, sig); // detached ⇒ its own process group (also reaps any child it spawned)
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* already gone */
      }
    }
  }
}

/** Stop the server and remove its temp HOME + the state file. */
export function stopIsolatedServer(): void {
  if (!fs.existsSync(STATE_PATH)) return;
  const s = readState();
  killPid(s.pid);
  fs.rmSync(s.home, { recursive: true, force: true });
  fs.rmSync(STATE_PATH, { force: true });
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
/** Recursive merge (objects merge, everything else — arrays included — replaces; `undefined` deletes). */
function mergeConfig(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = isObj(v) && isObj(out[k]) ? mergeConfig(out[k] as Json, v) : v;
  }
  return out;
}

/** Worker-side handle on the run's isolated server. */
export class IsolatedServer {
  private st: ServerState;
  constructor(st: ServerState) {
    this.st = st;
  }

  get port(): number {
    return this.st.port;
  }
  /** Temp HOME of the server. */
  get home(): string {
    return this.st.home;
  }
  get pool(): { from: number; to: number } {
    return this.st.pool;
  }
  /** Loopback-literal URL (`http://127.0.0.1:<port>`). */
  get url(): string {
    return `http://127.0.0.1:${this.st.port}`;
  }
  /** `http://<host>:<port>` for any host spelling the browser uses (`localhost`, `dash.test`, …). */
  origin(host = "localhost"): string {
    return `http://${host}:${this.st.port}`;
  }
  get configPath(): string {
    return path.join(this.st.home, ".pi", "dashboard", "config.json");
  }
  /** Current on-disk config. */
  config(): Json {
    return JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Json;
  }

  /**
   * Rewrite the config and restart the server on the SAME port. `patch` is deep-merged onto the
   * current config (`reset: true` merges onto the run's base config instead; `undefined` deletes a
   * key). Resolves once `/api/health` answers. Use `restart({ reset: true })` in an `afterEach`
   * (or `await using`-style try/finally) after a spec that changes the config.
   * `env` REPLACES the extra server environment (e.g. `{ PI_DASHBOARD_CSP: "enforce" }`); `reset: true`
   * clears it, an omitted `env` keeps the current one.
   */
  async restart(opts: { patch?: Json; reset?: boolean; env?: Record<string, string> } = {}): Promise<void> {
    const { patch = {}, reset = false } = opts;
    this.st = { ...this.st, extraEnv: opts.env ?? (reset ? undefined : this.st.extraEnv) };
    killPid(this.st.pid);
    for (let i = 0; i < 60 && (await this.isUp()); i++) await sleep(250);
    const base = reset ? baseConfig(this.st) : this.config();
    fs.writeFileSync(this.configPath, JSON.stringify(mergeConfig(base, patch), null, 2));
    const child = spawnServer(this.st);
    this.st = { ...this.st, pid: child.pid as number };
    writeState(this.st);
    await waitHealthy(this.st.port, child, this.st.log);
  }

  private async isUp(): Promise<boolean> {
    try {
      await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(1_000) });
      return true;
    } catch {
      return false;
    }
  }

  // ── log capture ────────────────────────────────────────────────────────────
  /** Byte offset of the end of the server log — pass to `logSince` to read only newer lines. */
  logMark(): number {
    return fs.statSync(this.st.log).size;
  }
  /** Log lines written after `mark` (default: whole log), optionally filtered by a RegExp. */
  logSince(mark = 0, filter?: RegExp): string[] {
    const buf = fs.readFileSync(this.st.log);
    const lines = buf.subarray(mark).toString("utf8").split("\n");
    return filter ? lines.filter((l) => filter.test(l)) : lines;
  }
  /** `[live-preview]` lines written after `mark` — the audit trail of mint/admit/refuse decisions. */
  livePreviewLog(mark = 0): string[] {
    return this.logSince(mark, /\[live-preview\]/);
  }

  // ── local operator credential ───────────────────────────────────────────────
  private localToken(): string {
    return fs.readFileSync(path.join(this.st.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
  }
  /** Proof headers for ONE request (the proof binds method + the loopback literal URL). */
  proofHeaders(method: string, url: string): Record<string, string> {
    return httpProofHeaders(this.localToken(), url, method);
  }
  /** REST call as the local operator (dials `127.0.0.1`, signs the request with the local token). */
  // biome-ignore lint/suspicious/noExplicitAny: REST bodies are untyped JSON; specs narrow as needed
  async api(method: string, apiPath: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
    const url = `${this.url}${apiPath}`;
    const res = await fetch(url, {
      method,
      headers: { ...this.proofHeaders(method, url), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json, headers: res.headers };
  }
  /**
   * Raw HTTP request to the dashboard listener with an arbitrary `Host` (and any headers) — for
   * label/pool hosts the OS may not resolve (`<label>.localhost`, `<label>.preview.test`): the
   * socket dials 127.0.0.1, the `Host` header selects the virtual host. No operator credential.
   */
  rawRequest(opts: { host: string; path?: string; method?: string; headers?: Record<string, string> }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: this.st.port, path: opts.path ?? "/", method: opts.method ?? "GET", headers: { host: opts.host, ...opts.headers } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
  /** One-time code for `GET /auth/local-proof?code=` (what `pi-dashboard open` does). */
  async mintLocalProofCode(): Promise<string> {
    const r = await this.api("POST", "/api/local-proof", {});
    const code = r.json?.data?.code;
    if (!code) throw new Error(`could not mint a local-proof code: ${r.status} ${JSON.stringify(r.json)}`);
    return code as string;
  }
  /** Unix socket of the pi gateway — fake bridge sessions connect here. */
  get gatewaySocket(): string {
    return path.join(this.st.home, ".pi", "dashboard", `gateway-${this.st.piPort}.sock`);
  }
}
