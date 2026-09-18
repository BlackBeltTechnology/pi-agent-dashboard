/**
 * Host seam — the narrow, mockable surface the gateway needs from the
 * dashboard plugin runtime.
 *
 * The gateway never touches `ServerPluginContext` directly: it depends on this
 * interface so every orchestration path is unit-testable with a fake host and
 * no dashboard, no Discord, and no pi session.
 *
 * Every method that reaches a session is a THIN adapter over an existing host
 * seam — no new protocol:
 *   sendPrompt / sendPromptResponse → `ctx.sendExtensionMessage` (the raw
 *   server→extension control lane the BROWSER's `send_prompt` /
 *   `prompt_response` messages already ride)
 *   subscribe                      → `ctx.subscribeSession` (in-process
 *   browser-protocol frames; see change: add-chat-gateway)
 *   abort                          → `ctx.abortSession`
 *   spawn                          → `ctx.spawnSession`
 *
 * See change: add-chat-gateway.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export interface SeamSession {
  id: string;
  cwd?: string;
  status?: string;
}

export interface SeamSpawnOptions {
  cwd: string;
  name?: string;
  /** Caller-minted correlation token, echoed by the host via `onSessionResolved`. */
  spawnToken?: string;
  /** Plugin-owned ref the host merges onto the session; the correlation payload. */
  pluginRef?: Record<string, unknown>;
  initialPrompt?: string;
  /** Additive extension allowlist (the L3 tool guard rides here). */
  extensions?: string[];
  /**
   * Per-extension config, namespaced by extension name — the host projects
   * each name/key pair into `PI_EXT_<NAME>_<KEY>` env on the spawned session.
   */
  extensionConfig?: Record<string, Record<string, string | string[]>>;
}

export type SpawnOutcome = { success: true } | { success: false; message?: string };

export interface HostSeam {
  /** False on a host that does not wire the in-process frame seam. */
  hasFrameSeam(): boolean;
  /** Subscribe to a session's live browser-protocol frames. Returns unsubscribe. */
  subscribe(sessionId: string, handler: (frame: unknown) => void): () => void;
  /** Send a prompt into a session. Returns false when the session is unreachable. */
  sendPrompt(sessionId: string, text: string, delivery: "followUp" | "steer"): boolean;
  /** Answer a PromptBus request. Returns false when the session is unreachable. */
  sendPromptResponse(sessionId: string, response: Record<string, unknown>): boolean;
  abort(sessionId: string): boolean;
  spawn(opts: SeamSpawnOptions): Promise<SpawnOutcome>;
  /** Live sessions, for the attach-to-existing source. */
  listSessions(): SeamSession[];
  /** Mint a fresh spawn-correlation token. */
  mintSpawnToken(): string;
  /** Subscribe to resolution of THIS plugin's own spawned sessions. */
  onSessionResolved(handler: (sessionId: string, pluginRef: Record<string, unknown>) => void): () => void;
  log(level: "info" | "warn" | "error", message: string): void;
}

function sessionShape(raw: unknown): SeamSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : typeof r.sessionId === "string" ? r.sessionId : undefined;
  if (!id) return null;
  return {
    id,
    cwd: typeof r.cwd === "string" ? r.cwd : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
  };
}

/**
 * Adapt a `ServerPluginContext` to the seam. `spawnSession`/`abortSession`/
 * `sendExtensionMessage` are trust-gated by the host, so this package's
 * manifest MUST keep `priority <= 100` — an untrusted install receives
 * `false`/inert hooks and the gateway degrades to a logged no-op rather than
 * silently appearing to work.
 */
export function createHostSeam(ctx: ServerPluginContext): HostSeam {
  return {
    hasFrameSeam: () => typeof ctx.subscribeSession === "function",
    subscribe(sessionId, handler) {
      if (typeof ctx.subscribeSession !== "function") return () => {};
      return ctx.subscribeSession(sessionId, handler);
    },
    sendPrompt(sessionId, text, delivery) {
      return ctx.sendExtensionMessage?.(sessionId, {
        type: "send_prompt",
        sessionId,
        text,
        delivery,
      }) ?? false;
    },
    sendPromptResponse(sessionId, response) {
      return ctx.sendExtensionMessage?.(sessionId, {
        type: "prompt_response",
        sessionId,
        ...response,
      }) ?? false;
    },
    abort(sessionId) {
      return ctx.abortSession(sessionId);
    },
    async spawn(opts) {
      const res = await ctx.spawnSession({
        cwd: opts.cwd,
        name: opts.name,
        spawnToken: opts.spawnToken,
        pluginRef: opts.pluginRef,
        initialPrompt: opts.initialPrompt,
        scope:
          opts.extensions || opts.extensionConfig
            ? { extensions: opts.extensions, extensionConfig: opts.extensionConfig }
            : undefined,
      } as Parameters<typeof ctx.spawnSession>[0]);
      return res.success ? { success: true } : { success: false, message: res.message };
    },
    listSessions() {
      const out: SeamSession[] = [];
      for (const raw of ctx.sessionManager.listActive()) {
        const s = sessionShape(raw);
        if (s) out.push(s);
      }
      return out;
    },
    mintSpawnToken: () => ctx.mintSpawnToken(),
    onSessionResolved(handler) {
      return ctx.onSessionResolved(handler);
    },
    log(level, message) {
      ctx.logger[level](message);
    },
  };
}
