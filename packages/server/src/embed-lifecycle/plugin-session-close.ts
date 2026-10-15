/**
 * Plugin session-close hook: the per-plugin closer registry, the in-memory
 * close-request set, and the `registerSessionCloser` / `requestSessionClose`
 * plugin-ctx API built on them.
 *
 * Scope (D2/D3): a closer is consulted ONLY by the idle reaper, ONLY for a
 * session whose close policy that plugin declared. `requestSessionClose` acts
 * only on a session the calling plugin declared. The declaring plugin id
 * (`closePolicy.owner`) is used purely for routing/authorization; governance
 * reads only the declared fields. Undeclared sessions and plugins that never
 * call these behave exactly as before.
 *
 * See OpenSpec change: add-session-close-plugin-hook.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SessionCloser } from "./idle-reaper.js";

export interface SessionCloserRegistry {
  /** Register (or replace) `ownerId`'s closer. */
  register(ownerId: string, closer: SessionCloser): void;
  /** Remove `ownerId`'s closer (plugin disabled / unloaded). */
  unregister(ownerId: string): void;
  get(ownerId: string): SessionCloser | undefined;
  /** Mark a close-at-next-quiet-point request (in-memory; lost on restart). */
  requestIdleClose(sessionId: string): void;
  isCloseRequested(sessionId: string): boolean;
  clearCloseRequest(sessionId: string): void;
}

export function createSessionCloserRegistry(): SessionCloserRegistry {
  const closers = new Map<string, SessionCloser>();
  const requested = new Set<string>();
  return {
    register: (ownerId, closer) => {
      closers.set(ownerId, closer);
    },
    unregister: (ownerId) => {
      closers.delete(ownerId);
    },
    get: (ownerId) => closers.get(ownerId),
    requestIdleClose: (sessionId) => {
      requested.add(sessionId);
    },
    isCloseRequested: (sessionId) => requested.has(sessionId),
    clearCloseRequest: (sessionId) => {
      requested.delete(sessionId);
    },
  };
}

export interface PluginSessionCloseDeps {
  registry: SessionCloserRegistry;
  getSession: (sessionId: string) => DashboardSession | undefined;
  /**
   * Graceful close now: shutdown hint + shared, confirmed terminator (the
   * graceful `abortSpawnedRun` path). `true` = termination confirmed.
   */
  closeNow: (sessionId: string) => Promise<boolean>;
  /** Close mode `archive`: mark archive-on-end (+ persist). */
  markArchiveOnEnd: (sessionId: string) => void;
  onCloseRequest?: () => void;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface PluginSessionCloseApi {
  registerSessionCloser: (closer: SessionCloser) => void;
  requestSessionClose: (args: { sessionId: string; reason: string; when: "now" | "idle" }) => Promise<boolean>;
}

/**
 * Build the two ctx members for one plugin. `trusted` mirrors the
 * `priority <= 100` gate of `spawnSession`: untrusted ⇒ register is a no-op,
 * request resolves `false`.
 */
export function createPluginSessionCloseApi(
  deps: PluginSessionCloseDeps,
  pluginId: string,
  trusted: boolean,
): PluginSessionCloseApi {
  const log = deps.log ?? ((m: string) => console.log(m));
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  return {
    registerSessionCloser: (closer) => {
      if (!trusted) return;
      if (typeof closer !== "function") return;
      if (deps.registry.get(pluginId)) log(`[session-close] plugin "${pluginId}" replaced its session closer`);
      deps.registry.register(pluginId, closer);
    },
    requestSessionClose: async (args) => {
      if (!trusted) return false;
      const sessionId = typeof args?.sessionId === "string" ? args.sessionId : "";
      const when = args?.when;
      const refuse = (why: string): false => {
        warn(`[session-close] plugin "${pluginId}" close request refused for ${sessionId || "(none)"}: ${why}`);
        return false;
      };
      const session = sessionId ? deps.getSession(sessionId) : undefined;
      if (!session) return refuse("unknown session");
      if (session.status === "ended") return refuse("session already ended");
      if (session.closePolicy?.owner !== pluginId) return refuse("session not declared by this plugin");
      if (when !== "now" && when !== "idle") return refuse(`invalid when "${String(when)}"`);
      deps.onCloseRequest?.();
      log(`[session-close] plugin "${pluginId}" requested close of ${sessionId} (when=${when}, reason=${String(args.reason ?? "")})`);
      if (when === "idle") {
        deps.registry.requestIdleClose(sessionId);
        return true;
      }
      if (session.closePolicy.mode === "archive") deps.markArchiveOnEnd(sessionId);
      return deps.closeNow(sessionId);
    },
  };
}
