/**
 * Test harness: the real team stack over a fake host port. The fake host
 * mimics spawn → resolve → guard-ready, so ensure/create run end to end.
 * See change: add-team-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import type { HostPort, HostSession } from "../conversations.js";
import { createTeam, type Team } from "../team.js";
import type { TeamConfig } from "../types.js";

interface FakeHost extends HostPort {
  sessions: Map<string, HostSession>;
  spawns: PluginSpawnOptions[];
  aborts: Array<{ sessionId?: string; spawnToken?: string; graceful?: boolean }>;
  /** resolve = register the session; ready = send the guard ready signal. */
  behavior: { resolve: boolean; ready: boolean; delayMs: number };
  emit(sessionId: string, event: unknown): void;
  resolveLate(runId: string): void;
  piHandlers: Map<string, (msg: unknown, sessionId: string) => void>;
}

function makeFakeHost(tmp: string): FakeHost {
  let n = 0;
  const resolvedHandlers: Array<(sid: string, ref: Record<string, unknown>) => void> = [];
  const eventHandlers: Array<(sid: string, ev: unknown) => void> = [];
  const piHandlers = new Map<string, (msg: unknown, sessionId: string) => void>();
  const pendingByRun = new Map<string, { sid: string; ref: Record<string, unknown> }>();
  const host: FakeHost = {
    sessions: new Map(),
    spawns: [],
    aborts: [],
    behavior: { resolve: true, ready: true, delayMs: 0 },
    piHandlers,
    async spawnSession(opts) {
      host.spawns.push(opts);
      const sid = `sess-${++n}`;
      const ref = (opts.pluginRef ?? {}) as Record<string, Record<string, unknown>> & { principalOwner?: { iss: string; sub: string } };
      const file = opts.resume?.sessionFile ?? path.join(tmp, "sessions", `${sid}.jsonl`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, "{}\n");
      const session: HostSession = {
        id: sid,
        cwd: opts.cwd,
        status: "idle",
        sessionFile: file,
        principalOwner: ref.principalOwner,
        // The real host stores the whole filed ref under pluginRefs.<pluginId>.
        pluginRefs: { team: ref as unknown as Record<string, unknown> },
      };
      const fire = () => {
        if (!host.behavior.resolve) {
          pendingByRun.set(String((ref.team as { runId?: string }).runId), { sid, ref: ref as Record<string, unknown> });
          return;
        }
        host.sessions.set(sid, session);
        for (const h of resolvedHandlers) h(sid, ref as Record<string, unknown>);
        if (host.behavior.ready) piHandlers.get("team_guard_ready")?.({ payload: { runId: (ref.team as { runId?: string }).runId } }, sid);
      };
      if (host.behavior.delayMs > 0) setTimeout(fire, host.behavior.delayMs);
      else queueMicrotask(fire);
      return { success: true, spawnToken: opts.spawnToken };
    },
    async abortSpawnedRun(a) {
      host.aborts.push(a);
      const s = a.sessionId ? host.sessions.get(a.sessionId) : undefined;
      if (s) s.status = "ended";
      return true;
    },
    getSession: (id) => host.sessions.get(id),
    listAll: () => [...host.sessions.values()],
    onSessionResolved(h) {
      resolvedHandlers.push(h);
      return () => resolvedHandlers.splice(resolvedHandlers.indexOf(h), 1);
    },
    onEvent(h) {
      eventHandlers.push(h);
      return () => eventHandlers.splice(eventHandlers.indexOf(h), 1);
    },
    registerPiHandler(type, h) {
      piHandlers.set(type, h);
    },
    emit(sid, ev) {
      for (const h of eventHandlers) h(sid, ev);
    },
    resolveLate(runId) {
      const p = pendingByRun.get(runId);
      if (!p) return;
      const session: HostSession = { id: p.sid, cwd: "/", status: "idle", pluginRefs: { team: p.ref } };
      host.sessions.set(p.sid, session);
      for (const h of resolvedHandlers) h(p.sid, p.ref);
    },
  };
  return host;
}

export interface Harness {
  tmp: string;
  home: string;
  app: FastifyInstance;
  team: Team;
  host: FakeHost;
  logs: string[];
  /** Create a directory under tmp and return its realpath. */
  dir(name: string): string;
  call(method: string, url: string, opts?: { user?: string; body?: unknown }): Promise<{ status: number; json: any }>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  mode?: "single" | "multi";
  config?: TeamConfig;
  spawnTimeoutMs?: number;
  guardExtensionPath?: string;
  renderPersona?: (p: import("../types.js").Persona, uk: string) => string;
  now?: () => number;
  ops?: import("../paths.js").FsOps;
}

export async function makeHarness(o: HarnessOptions = {}): Promise<Harness> {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "team-h-")));
  const home = path.join(tmp, "team-home");
  const app = Fastify();
  const host = makeFakeHost(tmp);
  const logs: string[] = [];
  const config: TeamConfig = o.config ?? {};
  const mode = o.mode ?? "multi";
  const identity = {
    isEnforced: () => mode === "multi",
    principalOf: (req: unknown) => {
      const u = (req as { headers?: Record<string, string | undefined> }).headers?.["x-user"];
      return u ? { iss: "https://iss", sub: u, name: u } : null;
    },
  };
  const team = createTeam({
    host,
    identity,
    fastify: app,
    config: () => config,
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    guardExtensionPath: o.guardExtensionPath ?? path.resolve(__dirname, "../../extension/index.ts"),
    distAppDir: path.join(tmp, "dist-app"),
    env: { PI_TEAM_HOME: home },
    piDir: path.join(tmp, ".pi"),
    spawnTimeoutMs: o.spawnTimeoutMs ?? 2_000,
    renderPersona: o.renderPersona,
    now: o.now,
    ops: o.ops,
    sweepEveryMs: 0,
  });
  await team.start();
  await app.ready();
  return {
    tmp,
    home,
    app,
    team,
    host,
    logs,
    dir(name) {
      const p = path.join(tmp, name);
      fs.mkdirSync(p, { recursive: true });
      return fs.realpathSync(p);
    },
    async call(method, url, opts = {}) {
      const res = await app.inject({
        method: method as "GET",
        url,
        headers: opts.user ? { "x-user": opts.user } : {},
        ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      });
      let json: unknown = null;
      try {
        json = res.json();
      } catch {
        json = res.body;
      }
      return { status: res.statusCode, json };
    },
    async close() {
      team.stop();
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export const API = "/api/plugins/team";
export const persona = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: slug,
  description: "",
  instructions: "be helpful",
  ...extra,
});
