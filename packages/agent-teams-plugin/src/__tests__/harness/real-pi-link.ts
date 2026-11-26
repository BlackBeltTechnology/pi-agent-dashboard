/**
 * Real-process flavor of the teams harness: connects REAL faux `pi --mode rpc`
 * teammates (running the REAL bridge entry `src/bridge/index.ts`) to the REAL
 * in-process server runtime of a `TeamsEnv`. A bare pi process has no dashboard
 * extension, so `real-pi-shim.ts` (loaded with `-e` beside the bridge) stands in for
 * the host's bridge side, over a loopback HTTP endpoint owned by this module:
 *
 *   pi (shim)  --POST /request-->  env.fake.lane(sessionId, type, payload)   (the lane)
 *   pi (shim)  <--GET  /events---  env.fake.base.onEmit → per-session queue  (emitEventToSession)
 *   env abortSession               → `{"type":"abort"}` on the member's stdin (host abort)
 *   pi (shim)  --POST /session-->  env.fake.addSession (+ resolveSession on a process's FIRST id)
 *   pi (shim)  --POST /ended-->    env.fake.endSession   (session_shutdown → onSessionEnded)
 *
 * A teammate is started through the server's own spawn path: `env.fake.base.onSpawn`
 * is wired so a `TeammateSpawn` op starts a process whose env is the host's
 * `PI_EXT_AGENT_TEAMS_*` projection of the spawn `extensionConfig`. The pluginRef binds
 * only the first session id of a process (as the host does); a replacement id (`/new`)
 * registers as a plain session. The host's persistent abort (re-abort every 200 ms for
 * up to 2 s until the agent is idle, design D6) is modelled so a wake turn started inside
 * that window would really be re-aborted. The process cwd is a hermetic temp dir, not
 * the spawn cwd (the env's `/work` does not exist).
 * Needs real time: build the env with `runtime: { clock: systemClock }`.
 * See change: add-agent-teams-core (test-plan #S14, #S87).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { AGENT_TEAMS_PLUGIN_ID } from "../../shared/plugin-id.js";
import { FauxPiProcess } from "./faux-pi-rpc.js";
import type { TeamsEnv } from "./teams-env.js";

const SHIM = fileURLToPath(new URL("./real-pi-shim.ts", import.meta.url));
const BRIDGE = fileURLToPath(new URL("../../bridge/index.ts", import.meta.url));
const PERSISTENT_ABORT_MS = 200;
const PERSISTENT_ABORT_WINDOW_MS = 2000;
const POLL_HOLD_MS = 20_000;
/** Env that would make the bridge treat the process as confined, blanked so an outer pi session cannot leak it in. */
const NEUTRAL_ENV = { PI_EXT_TEAM_TOOLS: "", PI_EXT_CHAT_GATEWAY_GUARD_POLICY: "" };

/** Closing text of the `agent-teams-teammate-*` faux scenarios (`qa/fixtures/faux-scenarios.ts`; kept equal by hand: the plugin cannot import outside its rootDir). */
export const TEAMMATE_ACK = "AGENT_TEAMS_TEAMMATE_ACK";

type PiEvent = { eventType: string; data: unknown };

/** One real teammate process and what the host side has seen of it. */
interface LinkedPi {
  readonly proc: FauxPiProcess;
  /** Every session id the process has had, oldest first (a `new_session` appends). */
  readonly sessionIds: string[];
  /** Session ids whose `session_shutdown` was reported. */
  readonly endedIds: string[];
  /** `/at-probe` reports (`activeTools` of the session that answered). */
  readonly probes: Array<{ sessionId: string; activeTools: string[] }>;
  /** `abort` commands written to the process by the host-abort model. */
  aborts: number;
  /** The current session id (last one registered). */
  currentSessionId(): string;
  /** Whether a low-level agent run is in progress (from its stdout events). */
  running(): boolean;
}

interface RealPiLinkOptions {
  /** Faux scenario fallback for the process (`FAUX_SCRIPT`). */
  fauxScript?: string;
  /** Faux stream speed; set low for abort scenarios. */
  tps?: number;
}

/** `teamId` → `TEAM_ID`, the projection the host applies to `extensionConfig` keys. */
function envKey(key: string): string {
  return `PI_EXT_${AGENT_TEAMS_PLUGIN_ID.toUpperCase().replace(/-/g, "_")}_${key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      raw += c;
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Wire real-process teammates into `env`; `close()` stops the endpoint and every process. */
export async function startRealPiLink(env: TeamsEnv, opts: RealPiLinkOptions = {}) {
  const procs = new Map<string, LinkedPi & { pluginRef?: Record<string, unknown> }>();
  const bySession = new Map<string, LinkedPi>();
  const requests: Array<{ sessionId: string; type: string; reply: unknown }> = [];
  const queues = new Map<string, PiEvent[]>();
  const waiters = new Map<string, () => void>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  let procSeq = 0;
  let closed = false;

  env.fake.base.onEmit((e) => {
    if (!e.delivered || !bySession.has(e.sessionId)) return;
    const q = queues.get(e.sessionId) ?? [];
    q.push({ eventType: e.eventType, data: e.data });
    queues.set(e.sessionId, q);
    waiters.get(e.sessionId)?.();
  });

  /** The host's abort of one linked session; installed on the env, and exported so a test can restore it after scripting a refusal. */
  const hostAbort = (sessionId: string): boolean => {
    const lp = bySession.get(sessionId);
    if (!lp) return false;
    const abort = (): void => {
      lp.aborts++;
      lp.proc.send({ type: "abort" });
    };
    abort();
    // Host persistent abort (`schedulePersistentAbort`, command-handler.ts): every 200 ms for up to
    // 2 s, stopping the first time it observes the agent idle.
    const started = Date.now();
    const timer = setInterval(() => {
      const running = lp.running();
      if (closed || Date.now() - started >= PERSISTENT_ABORT_WINDOW_MS || !running) {
        clearInterval(timer);
        timers.delete(timer);
      } else abort();
    }, PERSISTENT_ABORT_MS);
    timers.add(timer);
    return true;
  };
  env.fake.base.onAbort(hostAbort);

  /** Long-poll: answer at once when events are queued, else hold the request until one is (or `POLL_HOLD_MS`). */
  function holdEvents(sessionId: string, res: http.ServerResponse, send: (data: unknown) => void): void {
    const take = (): PiEvent[] => {
      const q = queues.get(sessionId) ?? [];
      queues.set(sessionId, []);
      return q;
    };
    if ((queues.get(sessionId)?.length ?? 0) > 0) return send(take());
    const finish = (): void => {
      clearTimeout(hold);
      waiters.delete(sessionId);
      if (!res.writableEnded) send(take());
    };
    const hold = setTimeout(finish, POLL_HOLD_MS);
    waiters.set(sessionId, finish);
    res.on("close", () => {
      clearTimeout(hold);
      if (!res.writableEnded) waiters.delete(sessionId);
    });
  }

  type Send = (data: unknown) => void;
  type Body = Record<string, unknown>;

  async function relayRequest(sessionId: string, body: Body, send: Send): Promise<void> {
    let reply: { ok: true; result: unknown } | { ok: false; error: string };
    try {
      reply = { ok: true, result: await env.fake.lane(sessionId, String(body.type), body.payload) };
    } catch (err) {
      reply = { ok: false, error: (err as Error).message.startsWith("no lane handler") ? "no_handler" : "unavailable" };
    }
    requests.push({ sessionId, type: String(body.type), reply });
    send(reply);
  }

  function registerSession(sessionId: string, body: Body): void {
    const lp = procs.get(String(body.proc));
    if (!lp) return;
    lp.sessionIds.push(sessionId);
    bySession.set(sessionId, lp);
    env.fake.addSession(sessionId, { cwd: String(body.cwd ?? lp.proc.cwd), ...(typeof body.sessionFile === "string" ? { sessionFile: body.sessionFile } : {}) });
    if (lp.sessionIds.length === 1 && lp.pluginRef) env.fake.resolveSession(sessionId, lp.pluginRef);
  }

  function endSession(sessionId: string, body: Body): void {
    procs.get(String(body.proc))?.endedIds.push(sessionId);
    bySession.delete(sessionId);
    queues.delete(sessionId);
    env.fake.endSession(sessionId);
  }

  async function route(url: URL, body: Body, res: http.ServerResponse): Promise<void> {
    const send: Send = (data) => {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
    };
    const sessionId = String(body.sessionId ?? url.searchParams.get("session") ?? "");
    switch (url.pathname) {
      case "/request":
        return relayRequest(sessionId, body, send);
      case "/session":
        registerSession(sessionId, body);
        return send({ ok: true });
      case "/ended":
        endSession(sessionId, body);
        return send({ ok: true });
      case "/probe":
        procs.get(String(body.proc))?.probes.push({ sessionId, activeTools: (body.activeTools as string[]) ?? [] });
        return send({ ok: true });
      case "/events":
        return holdEvents(sessionId, res, send);
      default:
        res.writeHead(404).end();
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void (req.method === "POST" ? readJson(req) : Promise.resolve({}))
      .then((body) => route(url, body, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function launch(spawn: PluginSpawnOptions): Promise<LinkedPi> {
    const id = String(++procSeq);
    const extensionConfig = (spawn.scope?.extensionConfig?.[AGENT_TEAMS_PLUGIN_ID] ?? {}) as Record<string, unknown>;
    const hint: Record<string, string> = {};
    for (const [k, v] of Object.entries(extensionConfig)) hint[envKey(k)] = typeof v === "string" ? v : JSON.stringify(v);
    const proc = new FauxPiProcess({
      extensions: [SHIM, BRIDGE],
      fauxScript: opts.fauxScript ?? "plain-text",
      ...(opts.tps ? { tps: opts.tps } : {}),
      env: { ...NEUTRAL_ENV, ...hint, AGENT_TEAMS_TEST_LINK_URL: url, AGENT_TEAMS_TEST_LINK_PROC: id },
    });
    const lp: LinkedPi & { pluginRef?: Record<string, unknown> } = {
      proc,
      sessionIds: [],
      endedIds: [],
      probes: [],
      aborts: 0,
      ...(spawn.pluginRef ? { pluginRef: spawn.pluginRef as Record<string, unknown> } : {}),
      currentSessionId: () => lp.sessionIds[lp.sessionIds.length - 1] as string,
      running: () => {
        for (let i = proc.records.length - 1; i >= 0; i--) {
          const t = proc.records[i]?.type;
          if (t === "agent_start") return true;
          if (t === "agent_end") return false;
        }
        return false;
      },
    };
    procs.set(id, lp);
    await proc.start();
    return lp;
  }

  const started: Array<Promise<LinkedPi>> = [];
  env.fake.base.onSpawn((spawn) => {
    started.push(launch(spawn));
    return { success: true, spawnToken: spawn.spawnToken ?? `link-${procSeq}` };
  });

  return {
    url,
    /** Every lane request the processes made, with the server's reply, in arrival order. */
    requests,
    /** The host-abort model wired into `env.fake.base.onAbort` (re-install it after scripting a refusal). */
    hostAbort,
    /** Teammates started so far (resolve once each process is running). */
    started: (): Promise<LinkedPi[]> => Promise.all(started),
    /** Resolve once `lp` has registered `n` session ids (default 1). */
    async untilSession(lp: LinkedPi, n = 1, timeoutMs = 30_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (lp.sessionIds.length < n) {
        if (Date.now() > deadline) throw new Error(`session ${n} never registered\n${lp.proc.stderrTail}`);
        await new Promise((r) => setTimeout(r, 25));
      }
      return lp.sessionIds[n - 1] as string;
    },
    async close(): Promise<void> {
      closed = true;
      for (const t of timers) clearInterval(t);
      await Promise.allSettled(started);
      await Promise.all([...procs.values()].map((lp) => lp.proc.stop()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
