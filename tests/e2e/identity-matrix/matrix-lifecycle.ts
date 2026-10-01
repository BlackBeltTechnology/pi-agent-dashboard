/**
 * Boot/teardown for the D21 identity setup matrix. Deliberately NOT the docker
 * harness: every scenario needs a differently-configured dashboard, and ten
 * docker boots per run would dwarf the assertions. Each scenario is a plain
 * `packages/server/src/cli.ts` process (repo `jiti/register`, no global pi) with
 * its own throwaway HOME, all against ONE in-process fake OIDC issuer that runs
 * the real interactive auth-code + PKCE flow.
 *
 * Needs a built client (`npm run build`) for the rendered-dashboard checks.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "../../../packages/shared/src/test-support/fake-oidc-issuer.js";
import { type MatrixState, SCENARIOS, type Scenario } from "./scenarios.js";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const STATE_PATH = path.join(REPO_ROOT, "test-results", "identity-matrix", "state.json");
/** The login-plane plugin under test (same-origin plugin frontend: sign-in, callback, app, logout). */
const LOGIN_PLUGIN_SRC = path.join(REPO_ROOT, "spike", "identity-login-plane");
const LOGIN_PLUGIN_ID = "identity-login-plane";

export const USERS = [
  { username: "anna", password: "anna-pw", sub: "sub-anna", email: "anna@example.test" },
  { username: "bela", password: "bela-pw", sub: "sub-bela" },
];

export function lanIPv4(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "0.0.0.0", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const BROKEN_PLUGIN = `// D21 matrix: registers a login descriptor, then fails activation.
export default async function registerPlugin(ctx) {
  ctx.registerBrowserLoginConfig({ loginUrl: "/identity-login/", logoutUrl: "/identity-login/logout" });
  throw new Error("simulated misconfiguration after descriptor registration");
}
`;

function writeHome(s: Scenario, port: number, issuer: string, baseDir = os.tmpdir()): string {
  const home = fs.mkdtempSync(path.join(baseDir, `pi-idmatrix-${s.id}-`));
  const pluginsDir = path.join(home, ".pi", "dashboard", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
  const dest = path.join(pluginsDir, LOGIN_PLUGIN_ID);
  if (s.loginPlugin === "good") {
    fs.cpSync(LOGIN_PLUGIN_SRC, dest, { recursive: true, filter: (p) => !p.includes(`${path.sep}test`) });
  } else if (s.loginPlugin === "broken") {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        name: LOGIN_PLUGIN_ID, version: "0.0.0", private: true, type: "module",
        "pi-dashboard-plugin": { id: LOGIN_PLUGIN_ID, displayName: "Broken login (D21)", priority: 400, server: "./server.mjs", claims: [] },
      }),
    );
    fs.writeFileSync(path.join(dest, "server.mjs"), BROKEN_PLUGIN);
  }
  const config: Record<string, unknown> = {
    port,
    bindHost: "0.0.0.0",
    identity: {
      trustedResolverPlugins: s.trustLoginPlugin ? [LOGIN_PLUGIN_ID] : [],
      ...(s.extra === "absent-policy" ? { trustedPolicyPlugin: "nope-policy" } : {}),
    },
    plugins: {
      "keycloak-resolver":
        s.resolver === "off" ? { enabled: false } : { enabled: true, issuer, audience: "pi-dashboard", allowInsecureHttp: true },
    },
  };
  if (s.extra === "bogus-provider") config.auth = { providers: { keycloak: { clientId: "x", clientSecret: "y" } } };
  if (s.extra === "github-provider") config.auth = { providers: { github: { clientId: "x", clientSecret: "y" } } };
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(config, null, 2));
  return home;
}

async function waitHealthy(port: number, child: ChildProcess, log: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dashboard on :${port} exited (${child.exitCode}); see ${log}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`dashboard on :${port} not healthy within ${timeoutMs / 1000}s; see ${log}`);
}

/**
 * Child env for a matrix dashboard. The login plugin has NO built-in Keycloak
 * default: it is configured via env here. "login-unconfigured" (row K) strips
 * it to prove sign-in is then not offered at all. Every inherited `PI_*`
 * variable is dropped: a run launched from inside a pi session would otherwise
 * hand its children the DEVELOPER's `PI_DASHBOARD_SOCKET`/`_URL`, and a pi the
 * spec starts would register with the real dashboard instead of the test one.
 */
function loginEnv(s: Scenario, home: string, issuer: string): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_")));
  if (s.extra === "login-unconfigured") return { ...base, HOME: home };
  return { ...base, HOME: home, PI_LOGIN_ISSUER: issuer, PI_LOGIN_BROWSER_ISSUER: issuer, PI_LOGIN_CLIENT_ID: "dashboard-web" };
}

function startDashboard(s: Scenario, port: number, home: string, issuer: string, log: string): ChildProcess {
  const fd = fs.openSync(log, "a");
  return spawn(
    process.execPath,
    ["--import", "jiti/register", "packages/server/src/cli.ts", "--host", "0.0.0.0", "--port", String(port)],
    { cwd: REPO_ROOT, env: loginEnv(s, home, issuer), stdio: ["ignore", fd, fd] },
  );
}

export interface DedicatedInstance {
  port: number;
  home: string;
  log: string;
  /** Env for a pi process started "from a terminal" against this instance. */
  terminalEnv: NodeJS.ProcessEnv;
  restart(): Promise<void>;
  /** Stops the dashboard AND every pi/keeper it spawned (keepers outlive a dashboard by design). */
  stop(killPids?: number[]): Promise<void>;
}

/** One private dashboard for a spec that spawns sessions or restarts the server. */
export async function bootDedicated(scenarioId: string, issuer: string): Promise<DedicatedInstance> {
  const s = SCENARIOS.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`unknown scenario ${scenarioId}`);
  const port = await freePort();
  // Short base dir: spawned sessions put a keeper Unix socket under HOME, and
  // macOS caps socket paths at ~104 bytes (os.tmpdir() is /var/folders/…/T/).
  const home = writeHome(s, port, issuer, process.platform === "win32" ? os.tmpdir() : "/tmp");
  // A dedicated gateway port, so sessions never reach another instance.
  const cfgPath = path.join(home, ".pi", "dashboard", "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, "utf8")), piPort: await freePort() }, null, 2));
  const log = path.join(path.dirname(STATE_PATH), `dedicated-${scenarioId}-${port}.log`);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  let child = startDashboard(s, port, home, issuer, log);
  await waitHealthy(port, child, log);
  const kill = async (c: ChildProcess) => {
    if (c.exitCode !== null) return;
    c.kill("SIGTERM");
    for (let i = 0; i < 20 && c.exitCode === null; i++) await new Promise((r) => setTimeout(r, 150));
    if (c.exitCode === null) c.kill("SIGKILL");
  };
  return {
    port,
    home,
    log,
    terminalEnv: { ...loginEnv(s, home, issuer) },
    async restart() {
      await kill(child);
      child = startDashboard(s, port, home, issuer, log);
      await waitHealthy(port, child, log);
    },
    async stop(killPids = []) {
      await kill(child);
      for (const pid of killPids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export async function bootMatrix(): Promise<{ state: MatrixState; stop: () => Promise<void> }> {
  const lanHost = lanIPv4();
  const hosts = ["localhost", "127.0.0.1", ...(lanHost ? [lanHost] : [])];
  const issuerSrv: FakeOidcIssuer = await startFakeOidcIssuer({
    host: "127.0.0.1",
    users: USERS,
    // Any port on the hosts the specs drive — mirrors an IdP client's registered URIs.
    redirectUriPrefixes: hosts.map((h) => `http://${h}:`),
  });
  const deadIssuer = `http://127.0.0.1:${await freePort()}`; // nothing listens there
  const logDir = path.dirname(STATE_PATH);
  fs.mkdirSync(logDir, { recursive: true });

  const children: ChildProcess[] = [];
  const instances: MatrixState["instances"] = {};
  for (const s of SCENARIOS) {
    const port = await freePort();
    const issuer = s.resolver === "dead" ? deadIssuer : issuerSrv.issuer;
    const home = writeHome(s, port, issuer);
    const log = path.join(logDir, `${s.id}.log`);
    fs.writeFileSync(log, "");
    const child = startDashboard(s, port, home, issuer, log);
    children.push(child);
    instances[s.id] = { port, home, log };
  }
  await Promise.all(SCENARIOS.map((s, i) => waitHealthy(instances[s.id].port, children[i], instances[s.id].log)));

  const state: MatrixState = { issuer: issuerSrv.issuer, lanHost, instances };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  return {
    state,
    stop: async () => {
      for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1_500));
      for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
      await issuerSrv.close();
      for (const { home } of Object.values(instances)) fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export function readState(): MatrixState {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as MatrixState;
}
