/**
 * `serve_mock_site` process management: start the project's OWN launcher on the
 * generated inheriting config (`prepareMockSite`), wait until the mock-site marker
 * answers, stop it, and kill every child on shutdown. Erasable-only TypeScript
 * (jiti gate). See change: add-live-component-mock-site (design D11),
 * add-mock-site-exact-env (D1, D10).
 */
import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { validateBase } from "./mock-site/base.mjs";
import { prepareMockSite } from "./mock-site/env.mjs";

export const DEFAULT_MOCK_SITE_PORT = 5299;
const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 3_000;
/** How long the emitter waits for a host to answer `mock-site:base-reservation` (canonical, D9). */
export const RESERVATION_WAIT_MS = 2_000;
/** The neutral probe name; no host-specific event name appears in this package. */
const RESERVATION_EVENT = "mock-site:base-reservation";

export const children = new Map<number, ChildProcess>();

export type ServeResult =
  | { ok: true; port: number; local: string; lan: string | null; root: string; launcher: string; config: string; base: string | null; note?: string }
  | { ok: false; error: string };

/** Ports the mock site must never take: 8000, PI_DASHBOARD_PORT, ~/.pi/dashboard/config.json port. */
function forbiddenPorts(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Set<number> {
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

function probe(port: number, base = "/"): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: `${base}__mock/decisions`, agent: false, timeout: 2000 }, (res) => {
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

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const t = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    child.kill("SIGTERM");
  });
}

/** The slice of `pi.events` the emitter needs. */
export interface ReservationEvents {
  emit(channel: string, data: unknown): void;
}

/**
 * Ask the host for a base (D9/D11): emit the neutral probe, then wait up to {@link RESERVATION_WAIT_MS} for `probe.pending`.
 * No listener / a listener that never sets `pending` / a throwing emit = no reservation WITHOUT waiting. A timeout, a
 * rejection or a malformed answer aborts `signal` (so a late reservation is released by the host) and means "root".
 */
async function reserveBase(events: ReservationEvents, port: number): Promise<{ base: string | null; why?: string; abort: () => void }> {
  const ac = new AbortController();
  const probeData: { port: number; pending?: Promise<unknown>; signal: AbortSignal } = { port, signal: ac.signal };
  try {
    events.emit(RESERVATION_EVENT, probeData);
  } catch {
    return { base: null, abort: () => ac.abort() };
  }
  if (probeData.pending === undefined) return { base: null, abort: () => ac.abort() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), RESERVATION_WAIT_MS); });
  try {
    const got = await Promise.race([Promise.resolve(probeData.pending), timeout]);
    if (got === "timeout") { ac.abort(); return { base: null, why: "no answer within 2 s", abort: () => ac.abort() }; }
    if (got === null || got === undefined) return { base: null, abort: () => ac.abort() };
    const v = validateBase((got as { base?: unknown })?.base);
    if (!v.ok || v.base === null) { ac.abort(); return { base: null, why: "the host answered with an unusable base", abort: () => ac.abort() }; }
    return { base: v.base, abort: () => ac.abort() };
  } catch (e) {
    ac.abort();
    const msg = String((e as Error)?.message ?? e).replace(/^base reservation unavailable:\s*/, "").slice(0, 120);
    return { base: null, why: msg || "the host refused", abort: () => ac.abort() };
  } finally {
    clearTimeout(timer);
  }
}

export async function startMockSite(opts: { dir?: string; port?: number; lan?: boolean; base?: unknown; events?: ReservationEvents }): Promise<ServeResult> {
  const root = path.resolve(opts.dir ?? process.cwd());
  const port = opts.port ?? DEFAULT_MOCK_SITE_PORT;
  if (forbiddenPorts().has(port)) return { ok: false, error: `port ${port} is reserved; pick another port` };
  if (children.has(port)) return { ok: false, error: `a mock site is already running on port ${port}` };
  // An explicit base is validated BEFORE anything starts; `/` means "no base" and emits no probe.
  const explicit = opts.base === undefined ? undefined : validateBase(opts.base);
  if (explicit && !explicit.ok) return { ok: false, error: explicit.error };
  const prep = await prepareMockSite(root);
  if (!prep.ok) return { ok: false, error: prep.error };
  if (explicit?.ok && explicit.base && !prep.baseFlag) {
    return { ok: false, error: `the ${prep.adapter} launcher adapter cannot apply a base path; start without \`base\` (the site is served at the root)` };
  }
  // The port is checked free BEFORE the probe is emitted, so a busy port never reserves a base.
  if (await portInUse(port)) return { ok: false, error: `port ${port} is busy; stop that process or pass another port` };

  let base: string | null = explicit?.ok ? explicit.base : null;
  let note: string | undefined;
  let abortReservation: () => void = () => {};
  if (explicit === undefined && prep.baseFlag && opts.events) {
    const r = await reserveBase(opts.events, port);
    base = r.base;
    abortReservation = r.abort;
    if (r.why) note = `base reservation unavailable: ${r.why}; the site starts at the root`;
  }
  const fail = (error: string): ServeResult => { abortReservation(); return { ok: false, error }; };

  const child = spawn(process.execPath, [prep.launcher, "--config", prep.generated, "--port", String(port), "--strictPort", ...(base && prep.baseFlag ? [prep.baseFlag, base] : [])], {
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
  child.once("error", () => { exited = true; });

  const t0 = Date.now();
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    if (exited) return fail(`mock site exited during start (port ${port}):\n${tail.trim()}`);
    if (await probe(port, base ?? "/")) {
      children.set(port, child);
      const ip = opts.lan ? lanIp() : null;
      const at = base ?? "";
      return { ok: true, port, root, local: `http://localhost:${port}${at}`, lan: ip ? `http://${ip}:${port}${at}` : null, launcher: prep.launcher, config: prep.config, base, ...(note ? { note } : {}) };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await killChild(child);
  return fail(`mock site not ready within ${READY_TIMEOUT_MS / 1000}s on port ${port}${base ? ` (probed ${base}__mock/decisions)` : ""}:\n${tail.trim()}`);
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
