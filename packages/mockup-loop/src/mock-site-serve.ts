/**
 * `serve_mock_site` process management: spawn the HOST project's Vite on
 * `mockups/mock-site.config.ts`, wait until the mock-site marker answers, stop
 * it, and kill every child on shutdown. Erasable-only TypeScript (jiti gate).
 * See change: add-live-component-mock-site (design D11).
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

export const DEFAULT_MOCK_SITE_PORT = 5299;
const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 3_000;

export const children = new Map<number, ChildProcess>();

export type ServeResult = { ok: true; port: number; local: string; lan: string | null; root: string } | { ok: false; error: string };

/** Ports the mock site must never take: 8000, PI_DASHBOARD_PORT, ~/.pi/dashboard/config.json port. */
export function forbiddenPorts(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Set<number> {
  const out = new Set<number>([8000]);
  const p = Number(env.PI_DASHBOARD_PORT);
  if (Number.isInteger(p) && p > 0) out.add(p);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".pi", "dashboard", "config.json"), "utf8"));
    const c = Number(cfg?.port);
    if (Number.isInteger(c) && c > 0) out.add(c);
  } catch {
    /* no config */
  }
  return out;
}

function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/__mock/decisions", agent: false, timeout: 2000 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try { resolve(JSON.parse(b)?.mockSite === true); } catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });
}

export function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const t = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    child.kill("SIGTERM");
  });
}

export async function startMockSite(opts: { dir?: string; port?: number; lan?: boolean }): Promise<ServeResult> {
  const root = path.resolve(opts.dir ?? process.cwd());
  const port = opts.port ?? DEFAULT_MOCK_SITE_PORT;
  if (forbiddenPorts().has(port)) return { ok: false, error: `port ${port} is reserved for the dashboard; pick another port` };
  const config = path.join(root, "mockups", "mock-site.config.ts");
  if (!fs.existsSync(config)) return { ok: false, error: `no mock site config: expected ${config}` };
  let viteBin: string;
  try {
    const req = createRequire(path.join(root, "package.json"));
    viteBin = path.join(path.dirname(req.resolve("vite/package.json")), "bin", "vite.js");
  } catch {
    return { ok: false, error: `vite not found from ${root}; install vite in the project` };
  }
  if (children.has(port)) return { ok: false, error: `a mock site is already running on port ${port}` };
  if (await portInUse(port)) return { ok: false, error: `port ${port} is busy; stop that process or pass another port` };

  const child = spawn(process.execPath, [viteBin, "--config", config, "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, MOCK_SITE_LAN: opts.lan ? "1" : "0", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const keep = (c: Buffer) => { tail = (tail + c.toString()).slice(-2000); };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited = false;
  child.once("exit", () => { exited = true; children.delete(port); });

  const t0 = Date.now();
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    if (exited) return { ok: false, error: `mock site exited during start (port ${port}):\n${tail.trim()}` };
    if (await probe(port)) {
      children.set(port, child);
      const ip = opts.lan ? lanIp() : null;
      return { ok: true, port, root, local: `http://localhost:${port}`, lan: ip ? `http://${ip}:${port}` : null };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await killChild(child);
  return { ok: false, error: `mock site not ready within ${READY_TIMEOUT_MS / 1000}s on port ${port}:\n${tail.trim()}` };
}

export async function stopMockSite(port: number): Promise<boolean> {
  const c = children.get(port);
  if (!c) return false;
  await killChild(c);
  children.delete(port);
  return true;
}

export async function stopAllMockSites(): Promise<void> {
  await Promise.all([...children.keys()].map((p) => stopMockSite(p)));
}
