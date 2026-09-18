/**
 * chat-gateway orchestrator.
 *
 * One `createChatGateway` instance owns the whole inbound/outbound loop for a
 * single chat platform:
 *
 *   inbound message ─▶ L1/L4 authorize ─▶ binding resolve (allowedRoots-gated)
 *                    ─▶ attach | spawn (correlation token) ─▶ send_prompt
 *
 *   browser-protocol frames ◀─ subscribe ─ text deltas → ONE throttled, edited
 *   message (chunked past the platform limit); prompt_request → native
 *   controls; prompt_dismiss → controls removed.
 *
 * Everything is injected (`HostSeam`, `PlatformAdapter`, stores, clock) so the
 * whole loop is testable with no dashboard, no Discord and no pi session.
 *
 * Security posture: every refusal is a reasoned refusal, never silent, and no
 * refusal path reaches a session. Bootstrapping requires `allowedRoots`;
 * spawning without it is refused, not defaulted.
 *
 * See change: add-chat-gateway.
 */

import type { PlatformAdapter, PlatformMessage } from "../adapters/base.js";
import { chunkForDiscord } from "../adapters/discord-payload.js";
import { authorize } from "./auth.js";
import { isWithinAllowedRoots, resolveCwd } from "./binding.js";
import type { ResolvedConfig } from "../shared/types.js";
import {
  type Binding,
  type ChatPlatform,
  type InboundMessage,
  bindingKey,
} from "../shared/types.js";
import { toPromptControl, type PromptControl } from "./prompts.js";
import type { BindingStore, SpawnCorrelator } from "./routing.js";
import type { HostSeam } from "./seam.js";
import { createEditThrottle, shouldSteer, stripSteerPrefix, type EditThrottle } from "./stream.js";

export interface ChatGatewayDeps {
  platform: ChatPlatform;
  seam: HostSeam;
  adapter: PlatformAdapter;
  config: ResolvedConfig;
  store: BindingStore;
  correlator: SpawnCorrelator;
  now?: () => number;
}

interface GatewayStatus {
  running: boolean;
  boundChannels: number;
  pendingSpawns: number;
}

/** Per-channel outbound rendering state. */
interface OutboundState {
  /** Finalized/streaming message ids, one per chunk. Only the tail is re-edited. */
  messageIds: string[];
  /** The assembled assistant text for the current turn. */
  text: string;
  throttle: EditThrottle;
  typing: boolean;
}

/** A rendered interactive prompt awaiting an answer. */
interface PendingPrompt {
  sessionId: string;
  channelId: string;
  messageId: string;
}

export interface ChatGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleInbound(msg: InboundMessage): Promise<void>;
  /** Feed one browser-protocol frame; used by the seam subscription and tests. */
  handleFrame(sessionId: string, frame: unknown): void;
  status(): GatewayStatus;
}

function frameType(frame: unknown): string | undefined {
  if (typeof frame !== "object" || frame === null) return undefined;
  const t = (frame as Record<string, unknown>).type;
  return typeof t === "string" ? t : undefined;
}

/** Latest assistant text carried by a `message_update` frame, or null. */
function assistantTextFrom(frame: unknown): string | null {
  const f = frame as Record<string, unknown>;
  const event = f.event as Record<string, unknown> | undefined;
  if (!event || event.eventType !== "message_update") return null;
  const data = event.data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "assistant") return null;
  const content = message.content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
      .map((c) => String((c as Record<string, unknown>).text ?? ""))
      .join("");
  }
  return typeof content === "string" ? content : "";
}

/** Map a normalized prompt control onto the vendored adapter's prompt shape. */
function toInteractivePrompt(control: PromptControl) {
  const method =
    control.kind === "unsupported"
      ? "input"
      : control.kind === "select" ||
          control.kind === "confirm" ||
          control.kind === "input" ||
          control.kind === "editor" ||
          control.kind === "notify"
        ? control.kind
        : "input";
  return {
    requestId: control.requestId,
    method,
    title: control.title,
    message: control.message,
    options: control.options,
    placeholder: control.placeholder,
    prefill: control.prefill,
  };
}

export function createChatGateway(deps: ChatGatewayDeps): ChatGateway {
  const { seam, adapter, config, store, correlator, platform } = deps;
  const now = deps.now ?? Date.now;

  const outbound = new Map<string, OutboundState>();
  const prompts = new Map<string, PendingPrompt>();
  const unsubscribes = new Map<string, () => void>();
  const subscriptions = new Set<string>();
  /** channelKey → the in-flight spawn correlation token. */
  const pendingSpawns = new Map<string, string>();
  let running = false;
  let offResolved: (() => void) | null = null;

  function stateFor(channelKey: string): OutboundState {
    let st = outbound.get(channelKey);
    if (!st) {
      const key = channelKey;
      st = {
        messageIds: [],
        text: "",
        typing: false,
        throttle: createEditThrottle({
          minIntervalMs: config.editThrottleMs,
          now,
          onFire: (content) => {
            void renderText(key, content).catch((err) =>
              seam.log("error", `chat-gateway render failed: ${String(err)}`),
            );
          },
        }),
      };
      outbound.set(key, st);
    }
    return st;
  }

  /**
   * Render the transcript for a channel as a sequence of platform messages:
   * message `i` holds `chunks[i]`, and only the LAST chunk is a live tail. A
   * reply that fits in one chunk therefore produces exactly ONE message edited
   * in place (F7); a reply that overflows continues in a NEW message rather
   * than being truncated (F6).
   */
  async function renderText(channelKey: string, content: string): Promise<void> {
    const st = stateFor(channelKey);
    const binding = store.get(channelKey);
    const channelId = binding?.channelId ?? channelKey.split(":")[1];
    if (!channelId) return;
    const chunks = chunkForDiscord(content);
    if (chunks.length === 0) return;
    for (let i = 0; i < chunks.length; i++) {
      const existing = st.messageIds[i];
      if (existing === undefined) {
        st.messageIds[i] = await adapter.sendMessage(channelId, chunks[i]);
      } else {
        await adapter.editMessage(channelId, existing, chunks[i]);
      }
    }
  }

  async function reply(channelId: string, text: string): Promise<void> {
    try {
      await adapter.sendMessage(channelId, text);
    } catch (err) {
      seam.log("error", `chat-gateway reply failed: ${String(err)}`);
    }
  }

  /** Resolve (or create) the binding for an inbound message. Null = already replied. */
  async function ensureBinding(msg: InboundMessage, channelKey: string): Promise<Binding | null> {
    const existing = store.get(channelKey);
    if (existing) return existing;

    const resolved = resolveCwd({
      persisted: undefined,
      fixedMap: config.fixedMap,
      channelKey,
      defaultCwd: config.defaultCwd,
      allowedRoots: config.allowedRoots,
    });

    if (resolved.kind === "resolved") {
      // The session id is NOT known until the host resolves the spawn, so no
      // binding is persisted here — `onSessionResolved` writes it. Persisting a
      // placeholder would strand a binding pointing at no session (X8).
      const started = await spawnIn(msg, channelKey, resolved.cwd, resolved.source);
      if (!started) return null;
      await reply(msg.channelId, `Starting a session in ${resolved.cwd}… answer again in a moment.`);
      return null;
    }

    // Interactive source: attach to a live in-range session if there is exactly
    // one unambiguous candidate; otherwise refuse. Never guess between several.
    const candidates = seam
      .listSessions()
      .filter((s) => typeof s.cwd === "string" && isWithinAllowedRoots(s.cwd, config.allowedRoots));
    if (candidates.length !== 1) {
      await reply(
        msg.channelId,
        candidates.length === 0
          ? "No session to attach to and no cwd configured (fixedMap/defaultCwd). Set a bound channel or configure a default cwd."
          : "Several sessions are open in allowedRoots — ambiguous attach. Configure a fixed channel→cwd map instead.",
      );
      return null;
    }
    const only = candidates[0];
    const binding: Binding = {
      platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
      sessionId: only.id,
      cwd: only.cwd as string,
      boundBy: msg.userId,
      source: "attach",
      createdAt: now(),
    };
    store.set(binding);
    subscribeSession(only.id);
    return binding;
  }

  /** Spawn a session in `cwd`; correlate it via the token echoed on resolution. */
  async function spawnIn(
    msg: InboundMessage,
    channelKey: string,
    cwd: string,
    source: string,
  ): Promise<boolean> {
    if (config.allowedRoots.length === 0) {
      await reply(msg.channelId, "Spawn refused: allowedRoots is empty. An operator must configure it.");
      return false;
    }
    if (!isWithinAllowedRoots(cwd, config.allowedRoots)) {
      await reply(msg.channelId, `Refused: ${cwd} is not inside allowedRoots.`);
      return false;
    }
    const token = seam.mintSpawnToken();
    correlator.expect(token, { channelKey, cwd, by: msg.userId });
    pendingSpawns.set(channelKey, token);
    // L3 (task 9): the companion guard is loaded into SPAWNED sessions only.
    // Attached sessions never reach this code path, so they stay ungated by
    // design — and no interceptor can be retrofitted into a running session
    // anyway. The extension identifier is NEVER invented: an unresolvable
    // reference would break every spawn, so it must be operator-supplied.
    const guardRef = config.toolPolicy && config.guardExtension ? config.guardExtension : undefined;
    const res = await seam.spawn({
      cwd,
      name: `chat:${channelKey}`,
      spawnToken: token,
      pluginRef: { kind: "chat-gateway", channelKey, spawnToken: token, source },
      ...(guardRef
        ? {
            extensions: [guardRef],
            extensionConfig: {
              "chat-gateway-guard": { policy: JSON.stringify(config.toolPolicy) },
            },
          }
        : {}),
    });
    if (!res.success) {
      // X8: no dangling binding, no half-correlated spawn.
      correlator.reject(token);
      pendingSpawns.delete(channelKey);
      await reply(msg.channelId, `Spawn failed: ${res.message ?? "unknown error"}`);
      return false;
    }
    return true;
  }

  function subscribeSession(sessionId: string): void {
    if (subscriptions.has(sessionId)) return;
    subscriptions.add(sessionId);
    const off = seam.subscribe(sessionId, (frame) => gateway.handleFrame(sessionId, frame));
    unsubscribes.set(sessionId, off);
  }

  function channelKeyFor(sessionId: string): string | undefined {
    for (const b of store.all()) {
      if (b.sessionId === sessionId) return bindingKey(b);
    }
    return undefined;
  }

  const gateway: ChatGateway = {
    async start() {
      if (running) return;
      running = true;
      offResolved = seam.onSessionResolved((sessionId, pluginRef) => {
        const token = pluginRef?.spawnToken;
        if (typeof token !== "string") return;
        const meta = correlator.resolve(token, sessionId);
        if (!meta) return;
        pendingSpawns.delete(meta.channelKey);
        store.set({
          platform,
          channelId: meta.channelKey.split(":")[1] ?? "",
          sessionId,
          cwd: meta.cwd,
          boundBy: meta.by,
          source: "spawn",
          createdAt: now(),
        });
        subscribeSession(sessionId);
      });
      await adapter.start({
        onMessage: async (m: PlatformMessage) => {
          try {
            await gateway.handleInbound({
              platform,
              channelId: m.channelId,
              threadId: typeof m.metadata?.threadId === "string" ? m.metadata.threadId : undefined,
              userId: m.userId,
              text: m.content,
              isDM: m.metadata?.isDM === true,
              startedAt: now(),
            });
          } catch (err) {
            seam.log("error", `chat-gateway inbound failed: ${String(err)}`);
          }
        },
        onInteractiveResponse: (resp) => {
          const rec = prompts.get(resp.requestId);
          if (!rec) return;
          prompts.delete(resp.requestId);
          const answer = resp.cancelled
            ? undefined
            : resp.value !== undefined
              ? resp.value
              : resp.confirmed === true
                ? "yes"
                : "no";
          seam.sendPromptResponse(rec.sessionId, {
            promptId: resp.requestId,
            answer,
            cancelled: resp.cancelled === true,
            source: "discord",
          });
        },
      });
    },

    async stop() {
      running = false;
      offResolved?.();
      offResolved = null;
      for (const off of unsubscribes.values()) off();
      unsubscribes.clear();
      subscriptions.clear();
      for (const st of outbound.values()) st.throttle.dispose();
      outbound.clear();
      prompts.clear();
      await adapter.stop();
    },

    async handleInbound(msg: InboundMessage) {
      // L1 identity + L4 isolation. A refusal NEVER reaches a session (X10).
      const decision = authorize({
        config: { allowlist: config.allowlist, admins: config.admins, groupChannels: config.groupChannels },
        userId: msg.userId,
        action: "talk",
        channelId: msg.channelId,
        isDM: msg.isDM,
      });
      if (!decision.allowed) {
        seam.log("info", `chat-gateway refused talk (${decision.reason}) channel=${msg.channelId}`);
        await reply(msg.channelId, `Refused: ${decision.reason}.`);
        return;
      }

      const key = bindingKey({ platform, channelId: msg.channelId, threadId: msg.threadId });
      const binding = await ensureBinding(msg, key);
      if (!binding || !binding.sessionId) return; // spawn pending; resolution binds it

      const live = seam.listSessions().some((s) => s.id === binding.sessionId);
      if (!live) {
        await reply(msg.channelId, "That session is unreachable (no bridge connection)."); // X1
        return;
      }

      const steer = shouldSteer(msg.text, config.steerPrefix);
      const text = stripSteerPrefix(msg.text, config.steerPrefix);
      const ok = seam.sendPrompt(binding.sessionId, text, steer ? "steer" : "followUp");
      if (!ok) {
        await reply(msg.channelId, "That session is unreachable (no bridge connection)."); // X1
      }
    },

    handleFrame(sessionId: string, frame: unknown) {
      const type = frameType(frame);
      const key = channelKeyFor(sessionId);
      if (!key) return;
      const st = stateFor(key);

      if (type === "event") {
        const text = assistantTextFrom(frame);
        if (text === null) return;
        st.text = text;
        if (!st.typing) {
          st.typing = true;
          const channelId = store.get(key)?.channelId;
          if (channelId) void adapter.setTyping(channelId, true).catch(() => {});
        }
        const due = st.throttle.request(text);
        if (due) {
          void renderText(key, due.fire).catch(() => {});
        }
        return;
      }

      if (type === "prompt_request") {
        const frameObj = frame as Record<string, unknown>;
        // `promptId` lives at the TOP level of the bridge frame (`prompt` is
        // the prompt payload). Without lifting it, the control's requestId is
        // empty and a later `prompt_dismiss` can never match it.
        const promptId = typeof frameObj.promptId === "string" ? frameObj.promptId : "";
        const raw = frameObj.prompt ?? frame;
        const control = toPromptControl(
          typeof raw === "object" && raw !== null ? { ...(raw as object), requestId: promptId } : raw,
        );
        const channelId = store.get(key)?.channelId;
        if (!channelId) return;
        void adapter
          .sendInteractive(channelId, toInteractivePrompt(control))
          .then(({ messageId }) => {
            prompts.set(control.requestId, { sessionId, channelId, messageId });
          })
          .catch((err) => seam.log("error", `prompt render failed: ${String(err)}`));
        return;
      }

      if (type === "prompt_dismiss" || type === "prompt_cancel") {
        const promptId = (frame as Record<string, unknown>).promptId;
        if (typeof promptId !== "string") return;
        const rec = prompts.get(promptId);
        if (!rec) return;
        prompts.delete(promptId);
        // F2: answered on the web first → the Discord controls must go away.
        void adapter.cleanupInteractive?.(rec.channelId, rec.messageId).catch(() => {});
        return;
      }

      if (type === "session_state_reset") {
        st.messageIds = [];
        st.text = "";
        st.typing = false;
        st.throttle.dispose();
      }
    },

    status() {
      return {
        running,
        boundChannels: store.all().length,
        pendingSpawns: pendingSpawns.size,
      };
    },
  };

  return gateway;
}
