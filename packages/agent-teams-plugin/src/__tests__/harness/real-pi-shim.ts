/**
 * TEST SHIM pi extension (loaded with `-e` next to the REAL bridge entry by
 * `real-pi-link.ts`): stands in for the dashboard's bridge-side host, which a bare
 * `pi --mode rpc` process does not have. It
 *  1. installs the lane global `globalThis[Symbol.for("pi-dashboard.pluginRequest")]`
 *     (`requestPluginServer`) as a function forwarding `(pluginId, type, payload)` to
 *     the test process over loopback HTTP, tagged with the CURRENT pi session id;
 *  2. long-polls `GET /events` and re-emits the server's `emitEventToSession` pushes on
 *     `pi.events` (what the dashboard bridge does for the plugin's mail events);
 *  3. registers/ends the session with the in-process host (`/session`, `/ended`);
 *  4. registers `/at-probe`, a command that reports `pi.getActiveTools()` on demand.
 * Everything is per extension instance: pi re-instantiates extensions on a session
 * replacement (`new_session`), so the new instance re-learns the new session id.
 * Inert unless `AGENT_TEAMS_TEST_LINK_URL` is set. Plain structural types only: this
 * file runs inside pi (jiti), not under the repo's compiler.
 * See change: add-agent-teams-core (test-plan #S14, #S87).
 */

/** Same symbol `@blackbelt-technology/dashboard-plugin-runtime/bridge` reads. */
const LANE_SYMBOL = Symbol.for("pi-dashboard.pluginRequest");

interface ShimCtx {
  cwd?: string;
  sessionManager: { getSessionId(): string; getSessionFile?(): string | undefined };
}

interface ShimPi {
  on(event: string, handler: (event: unknown, ctx: ShimCtx) => unknown): void;
  events: { emit(type: string, data: unknown): void };
  getActiveTools(): string[];
  registerCommand(name: string, options: { description: string; handler: () => Promise<void> | void }): void;
}

export default function realPiShim(pi: ShimPi): void {
  const base = process.env.AGENT_TEAMS_TEST_LINK_URL;
  if (!base) return;
  const proc = process.env.AGENT_TEAMS_TEST_LINK_PROC ?? "0";
  let sessionId: string | undefined;
  let polling = false;
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  };

  (globalThis as Record<symbol, unknown>)[LANE_SYMBOL] = async (pluginId: string, type: string, payload?: unknown) => {
    await ready; // no request goes out before the host knows this session
    try {
      return await post("/request", { proc, sessionId, pluginId, type, payload });
    } catch {
      return { ok: false, error: "unavailable" };
    }
  };

  async function poll(id: string): Promise<void> {
    while (polling && sessionId === id) {
      try {
        const res = await fetch(`${base}/events?session=${encodeURIComponent(id)}`);
        const events = (await res.json()) as Array<{ eventType: string; data: unknown }>;
        for (const e of events) pi.events.emit(e.eventType, e.data);
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    sessionId = id;
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    await post("/session", { proc, sessionId: id, cwd: ctx.cwd, ...(sessionFile ? { sessionFile } : {}) });
    polling = true;
    release();
    void poll(id);
  });

  pi.on("session_shutdown", async () => {
    polling = false;
    if (sessionId) await post("/ended", { proc, sessionId }).catch(() => undefined);
  });

  pi.registerCommand("at-probe", {
    description: "test shim: report the active tool names to the in-process host",
    handler: async () => {
      await post("/probe", { proc, sessionId, activeTools: pi.getActiveTools() });
    },
  });
}
