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

import type { InteractiveResponse, PlatformAdapter, PlatformMessage } from "../adapters/base.js";
import { chunkForDiscord } from "../adapters/discord-payload.js";
import type { ResolvedConfig } from "../shared/types.js";
import {
  type Binding,
  bindingKey,
  type ChatPlatform,
  type InboundMessage,
} from "../shared/types.js";
import { authorize, createPairing, type Pairing } from "./auth.js";
import { isWithinAllowedRoots, resolveCwd } from "./binding.js";
import {
  composeBatchAnswers,
  composeMultiselectAnswer,
  multiselectToSequence,
  type PromptControl,
  toPromptControl,
} from "./prompts.js";
import type { BindingStore, SpawnCorrelator } from "./routing.js";
import type { HostSeam, SpawnOutcome } from "./seam.js";
import { createEditThrottle, type EditThrottle, shouldSteer, stripSteerPrefix } from "./stream.js";
import type { TeamController } from "./team/controller.js";

export interface ChatGatewayDeps {
  platform: ChatPlatform;
  seam: HostSeam;
  adapter: PlatformAdapter;
  config: ResolvedConfig;
  store: BindingStore;
  correlator: SpawnCorrelator;
  /**
   * Optional team-controls layer. When present it gates every action-bearing
   * request at one chokepoint, records the attempt, and gates prompt answers.
   */
  team?: TeamController;
  now?: () => number;
  /** The L1 pairing code state machine; a fresh one is minted by default. */
  pairing?: Pairing;
}

interface GatewayStatus {
  running: boolean;
  boundChannels: number;
  pendingSpawns: number;
  /** The live L1 pairing code ("" once consumed/locked/expired). */
  pairingCode: string;
}

/** Per-channel outbound rendering state. */
interface OutboundState {
  /** Finalized/streaming message ids, one per chunk. Only the tail is re-edited. */
  messageIds: string[];
  /** The assembled assistant text for the current turn. */
  text: string;
  throttle: EditThrottle;
  typing: boolean;
  /** Serializes renders for this channel so overlapping fires cannot double-send. */
  rendering: Promise<void>;
}

/** A rendered interactive prompt awaiting an answer. */
interface PendingPrompt {
  sessionId: string;
  channelId: string;
  messageId: string;
  /** Whether the prompt's channel is a DM (L4 re-authorization on click). */
  isDM: boolean;
  /** The principal whose command raised this question; absent for an attached session. */
  invoker?: string;
  /** Set when this prompt is one step of a multiselect/batch sequence (7.2). */
  sequenceRootId?: string;
}

/**
 * 7.2 composition shim: `multiselect`/`batch` are not adapter primitives, so
 * they are rendered as an ordered sequence of supported prompts. Answers are
 * accumulated here and submitted as ONE `prompt_response` under the root id —
 * the same shape the web UI's encoder produces.
 */
interface SequenceState {
  rootId: string;
  sessionId: string;
  channelId: string;
  /** Whether the channel is a DM (L4 re-authorization for each sub-prompt). */
  isDM: boolean;
  kind: "multiselect" | "batch";
  /** Ordered sub-prompts (multiselect toggles exclude the trailing submit). */
  steps: PromptControl[];
  /** Present for multiselect: the trailing "confirm selection" gate. */
  submit?: PromptControl;
  /** Index of the next un-answered step. */
  index: number;
  /** Index-aligned batch answers. */
  answers: string[];
  /** Per-option multiselect toggles, index-aligned with `optionValues`. */
  toggles: boolean[];
  optionValues: string[];
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
  const { seam, adapter, config, store, correlator, platform, team } = deps;
  const now = deps.now ?? Date.now;
  const pairing = deps.pairing ?? createPairing({ now });

  const outbound = new Map<string, OutboundState>();
  const prompts = new Map<string, PendingPrompt>();
  /** rootRequestId → in-flight multiselect/batch sequence (7.2). */
  const sequences = new Map<string, SequenceState>();
  const unsubscribes = new Map<string, () => void>();
  const subscriptions = new Set<string>();
  /** sessionId → the principal whose command last drove it (question-invoker). */
  const lastInvoker = new Map<string, string>();
  /** channelKey → the in-flight spawn correlation token. */
  const pendingSpawns = new Map<string, string>();
  /** channelKey → when the spawn started (for the stale-spawn sweep). */
  const pendingSpawnAt = new Map<string, number>();
  /** A spawn that never resolves must not block its channel forever. */
  const SPAWN_TTL_MS = 5 * 60_000;

  /** Drop spawn entries older than the TTL so a lost resolution cannot wedge a channel. */
  function sweepStaleSpawns(): void {
    const cutoff = now() - SPAWN_TTL_MS;
    for (const [key, token] of pendingSpawns) {
      const at = pendingSpawnAt.get(key);
      if (at === undefined || at < cutoff) {
        correlator.reject(token);
        pendingSpawns.delete(key);
        pendingSpawnAt.delete(key);
      }
    }
  }
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
        rendering: Promise.resolve(),
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
  async function doRenderText(channelKey: string, content: string): Promise<void> {
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
      } else if (i === chunks.length - 1) {
        // C4/C8: only the TAIL grows; earlier chunks are finalized. Re-editing
        // every chunk would spend N edits per throttle tick (429 risk).
        await adapter.editMessage(channelId, existing, chunks[i]);
      }
    }
  }

  /**
   * Serialize renders per channel: the throttle can fire again while a slow
   * Discord send/edit is still in flight, and two overlapping renders would
   * both observe an empty `messageIds[i]` and post the chunk twice.
   */
  function renderText(channelKey: string, content: string): Promise<void> {
    const st = stateFor(channelKey);
    const run = st.rendering.then(() => doRenderText(channelKey, content));
    st.rendering = run.catch(() => {}); // keep the chain alive on failure
    return run;
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

    // F7: a spawn takes seconds and the binding is written only at resolution.
    // A second message inside that window must NOT start a second session.
    sweepStaleSpawns();
    if (pendingSpawns.has(channelKey)) {
      await reply(msg.channelId, "A session is already starting for this channel — one moment.");
      return null;
    }

    // L2: CREATING a binding is a privileged op. An allowlisted non-admin may
    // TALK on an already-bound channel but may not bind a new one; otherwise
    // the admin allowlist would gate nothing (E12).
    const bindDecision = authorize({
      config: { allowlist: config.allowlist, admins: config.admins, groupChannels: config.groupChannels },
      userId: msg.userId,
      action: "bind",
      channelId: msg.channelId,
      parentChannelId: msg.parentChannelId,
      isDM: msg.isDM,
    });
    if (!bindDecision.allowed) {
      await reply(msg.channelId, `Refused: ${bindDecision.reason}. An admin must bind this channel first.`);
      return null;
    }

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
      isDM: msg.isDM,
      createdAt: now(),
    };
    store.set(binding);
    subscribeSession(only.id);
    return binding;
  }

  /**
   * Mint a correlation token, register the pending spawn, and issue the spawn.
   * Shared by the fresh-spawn and resume transitions so the L3 guard wiring and
   * the no-dangling-binding invariant live in exactly one place.
   */
  async function spawnCorrelated(
    msg: InboundMessage,
    channelKey: string,
    cwd: string,
    source: string,
    resume?: { sessionFile: string },
  ): Promise<SpawnOutcome> {
    // Fail CLOSED on a misconfigured guard: pi treats an unresolvable `-e <ref>`
    // as non-fatal and keeps spawning, so a policy without a guard would run an
    // UNGATED session that looks protected. Refuse instead.
    if (config.toolPolicy && !config.guardExtension) {
      seam.log(
        "error",
        "chat-gateway: toolPolicy is set but guardExtension is missing — refusing to spawn an ungated session",
      );
      return {
        success: false,
        message:
          "L3 toolPolicy is configured but guardExtension is not — refusing to spawn an ungated session.",
      };
    }
    const token = seam.mintSpawnToken();
    correlator.expect(token, {
      channelKey,
      channelId: msg.channelId,
      threadId: msg.threadId,
      isDM: msg.isDM,
      cwd,
      by: msg.userId,
    });
    pendingSpawns.set(channelKey, token);
    pendingSpawnAt.set(channelKey, now());
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
      ...(resume ? { resume } : {}),
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
      pendingSpawnAt.delete(channelKey);
    }
    return res;
  }

  /** Spawn a fresh session in `cwd`; correlate it via the token echoed on resolution. */
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
    const res = await spawnCorrelated(msg, channelKey, cwd, source);
    if (!res.success) {
      await reply(msg.channelId, `Spawn failed: ${res.message ?? "unknown error"}`);
      return false;
    }
    return true;
  }

  /**
   * Task 4.3 `resume(continue)` transition: a persisted binding whose session
   * ENDED is resumed from its transcript rather than treated as unreachable. A
   * live-but-disconnected session is NEVER silently replaced — that is the
   * 502/X1 case and stays an in-channel error. Returns true when the message
   * was handled (resumed OR refused with a reason).
   */
  async function resumeIn(
    msg: InboundMessage,
    channelKey: string,
    binding: Binding,
  ): Promise<boolean> {
    const rec = seam.getSession(binding.sessionId);
    if (!rec || rec.status !== "ended" || !rec.sessionFile) return false;
    // Every cwd passes the boundary on every transition, not just at bind time.
    if (!isWithinAllowedRoots(binding.cwd, config.allowedRoots)) {
      await reply(msg.channelId, `Refused: ${binding.cwd} is not inside allowedRoots.`);
      return true;
    }
    const res = await spawnCorrelated(msg, channelKey, binding.cwd, "resume", {
      sessionFile: rec.sessionFile,
    });
    if (!res.success) {
      await reply(msg.channelId, `Resume failed: ${res.message ?? "unknown error"}`);
      return true;
    }
    await reply(msg.channelId, "Resuming the session… answer again in a moment.");
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

  /** Render the next un-answered sub-prompt (or the multiselect submit gate). */
  async function renderSequenceStep(state: SequenceState): Promise<void> {
    const next =
      state.index < state.steps.length
        ? state.steps[state.index]
        : state.kind === "multiselect"
          ? state.submit
          : undefined;
    if (!next) {
      finishSequence(state, composeBatchAnswers(state.answers));
      return;
    }
    const { messageId } = await adapter.sendInteractive(state.channelId, toInteractivePrompt(next));
    prompts.set(next.requestId, {
      sessionId: state.sessionId,
      channelId: state.channelId,
      messageId,
      isDM: state.isDM,
      invoker: lastInvoker.get(state.sessionId),
      sequenceRootId: state.rootId,
    });
  }

  /**
   * 7.2: `multiselect`/`batch` are not adapter primitives, so render them as an
   * ordered sequence of supported prompts and submit ONE root `prompt_response`
   * on completion — the shape the web UI's encoder produces.
   */
  function beginSequence(
    control: PromptControl,
    sessionId: string,
    channelId: string,
    isDM: boolean,
  ): void {
    if (control.kind === "multiselect") {
      const seq = multiselectToSequence(control.requestId, control.title, control.options ?? []);
      const submit = seq[seq.length - 1];
      const state: SequenceState = {
        rootId: control.requestId,
        sessionId,
        channelId,
        isDM,
        kind: "multiselect",
        steps: seq.slice(0, seq.length - 1),
        submit,
        index: 0,
        answers: [],
        toggles: [],
        optionValues: control.options ?? [],
      };
      sequences.set(state.rootId, state);
      void renderSequenceStep(state).catch((err) =>
        seam.log("error", `sequence render failed: ${String(err)}`),
      );
      return;
    }

    const steps = control.subPrompts ?? [];
    if (steps.length === 0) {
      // No questions → the empty answer IS the answer; never leave the session hanging.
      seam.sendPromptResponse(sessionId, {
        promptId: control.requestId,
        answer: "[]",
        cancelled: false,
        source: "discord",
      });
      return;
    }
    const state: SequenceState = {
      rootId: control.requestId,
      sessionId,
      channelId,
      isDM,
      kind: "batch",
      steps,
      index: 0,
      answers: [],
      toggles: [],
      optionValues: [],
    };
    sequences.set(state.rootId, state);
    void renderSequenceStep(state).catch((err) =>
      seam.log("error", `sequence render failed: ${String(err)}`),
    );
  }

  function finishSequence(state: SequenceState, answer: string): void {
    sequences.delete(state.rootId);
    seam.sendPromptResponse(state.sessionId, {
      promptId: state.rootId,
      answer,
      cancelled: false,
      source: "discord",
    });
  }

  /** A user cancelled mid-sequence → converge on the SAME root id, cancelled. */
  function cancelSequence(state: SequenceState): void {
    sequences.delete(state.rootId);
    seam.sendPromptResponse(state.sessionId, {
      promptId: state.rootId,
      answer: undefined,
      cancelled: true,
      source: "discord",
    });
  }

  /**
   * The prompt was answered/dismissed on ANOTHER surface (web first): drop the
   * sequence and its controls WITHOUT a further response — the session already
   * has its answer (F2).
   */
  function dropSequence(rootId: string): void {
    sequences.delete(rootId);
    for (const [rid, rec] of prompts) {
      if (rec.sequenceRootId === rootId) {
        prompts.delete(rid);
        void adapter.cleanupInteractive?.(rec.channelId, rec.messageId).catch(() => {});
      }
    }
  }

  async function advanceSequence(
    state: SequenceState,
    resp: InteractiveResponse,
  ): Promise<void> {
    const isSubmit =
      state.kind === "multiselect" && resp.requestId === state.submit?.requestId;
    if (resp.cancelled) {
      cancelSequence(state);
      return;
    }
    if (isSubmit) {
      if (resp.confirmed === false) {
        cancelSequence(state);
        return;
      }
      finishSequence(state, composeMultiselectAnswer(state.optionValues, state.toggles));
      return;
    }
    if (state.kind === "multiselect") {
      state.toggles.push(resp.confirmed === true);
    } else {
      state.answers.push(
        resp.value !== undefined ? resp.value : resp.confirmed === true ? "yes" : "no",
      );
    }
    state.index += 1;
    if (state.kind === "batch" && state.index >= state.steps.length) {
      finishSequence(state, composeBatchAnswers(state.answers));
      return;
    }
    await renderSequenceStep(state);
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
        pendingSpawnAt.delete(meta.channelKey);
        // F3: preserve the EXACT binding identity. A thread spawn must land on
        // the thread key, not its parent — otherwise the thread binding never
        // resolves and every follow-up message spawns ANOTHER session.
        store.set({
          platform,
          channelId: meta.channelId,
          threadId: meta.threadId,
          sessionId,
          cwd: meta.cwd,
          boundBy: meta.by,
          source: "spawn",
          isDM: meta.isDM,
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
              parentChannelId:
                typeof m.metadata?.parentChannelId === "string"
                  ? m.metadata.parentChannelId
                  : undefined,
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
          // L1/L4: a click is an ACTOR's action, so re-authorize it. Rendering
          // the prompt is NOT a grant — any member of an opted-in group channel
          // can see the bot's buttons. A refused click must NOT consume the
          // prompt (an authorized user may still answer it).
          const decision = authorize({
            config: { allowlist: config.allowlist, admins: config.admins, groupChannels: config.groupChannels },
            userId: resp.userId ?? "",
            action: "talk",
            channelId: rec.channelId,
            // L4: use the BINDING's real DM-ness. A synthesized value would
            // treat a THREAD (id not in groupChannels) as a DM and skip L4.
            isDM: rec.isDM,
          });
          if (!decision.allowed) {
            seam.log(
              "info",
              `chat-gateway refused prompt response (${decision.reason}) channel=${rec.channelId}`,
            );
            return;
          }
          // Team-controls: answering requires >= control, and is invoker-only
          // when the question was raised by a specific principal's command
          // (X19/X20/X21). A refused click must NOT consume the prompt.
          if (team) {
            const gate = team.authorizeRequest({
              author: { id: resp.userId ?? "" },
              channelId: rec.channelId,
              verb: "prompt_response",
              target: rec.sessionId,
            });
            if (gate.kind === "refusal") {
              seam.log("info", `chat-gateway refused prompt response (${gate.reason})`);
              return;
            }
            if (rec.invoker && rec.invoker !== resp.userId) {
              seam.log("info", "chat-gateway refused prompt response (not the invoker)");
              return;
            }
          }
          prompts.delete(resp.requestId);
          if (rec.sequenceRootId) {
            // A sub-prompt of a multiselect/batch sequence: drop its controls
            // and advance the sequence (7.2).
            void adapter.cleanupInteractive?.(rec.channelId, rec.messageId).catch(() => {});
            const state = sequences.get(rec.sequenceRootId);
            if (state) {
              void advanceSequence(state, resp).catch((err) =>
                seam.log("error", `sequence advance failed: ${String(err)}`),
              );
            }
            return;
          }
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

      // F4: re-subscribe PERSISTED bindings. Subscribing only at bind time
      // leaves a restarted gateway unable to receive event/prompt_request
      // frames — inbound would work while Discord showed none of the output.
      for (const b of store.all()) {
        subscribeSession(b.sessionId);
      }
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
      sequences.clear();
      for (const token of correlator.pending()) correlator.reject(token);
      pendingSpawns.clear();
      pendingSpawnAt.clear();
      lastInvoker.clear();
      await adapter.stop();
    },

    async handleInbound(msg: InboundMessage) {
      // L1 pairing (spec R7): the allowlist is ESTABLISHED by redeeming the
      // current code. Only a DM may pair — a code redeemed in a public group
      // channel would leak access to everyone reading it. Only a 6-DIGIT shape
      // is a pairing ATTEMPT, so an arbitrary DM cannot exhaust the lockout.
      if (msg.isDM && !config.allowlist.includes(msg.userId)) {
        const candidate = msg.text.trim();
        if (/^\d{6}$/.test(candidate) && pairing.attempt(candidate)) {
          config.allowlist = [...config.allowlist, msg.userId];
          seam.persistAllowlist(config.allowlist);
          await reply(msg.channelId, "Paired. You can now talk to sessions.");
          return;
        }
      }

      // L1 identity + L4 isolation. A refusal NEVER reaches a session (X10).
      const decision = authorize({
        config: { allowlist: config.allowlist, admins: config.admins, groupChannels: config.groupChannels },
        userId: msg.userId,
        action: "talk",
        channelId: msg.channelId,
        parentChannelId: msg.parentChannelId,
        isDM: msg.isDM,
      });
      if (!decision.allowed) {
        seam.log("info", `chat-gateway refused talk (${decision.reason}) channel=${msg.channelId}`);
        // A guild channel the operator never opted in must see NOTHING — a
        // reply would make the bot answer every message in every channel it
        // can read (noise + 429s + likely a guild ban). Only an identified
        // user gets a reasoned refusal.
        if (decision.reason !== "group_channel_not_opted_in") {
          await reply(msg.channelId, `Refused: ${decision.reason}.`);
        }
        return;
      }

      // Team-controls: the command log is NEVER readable from chat (X26).
      if (team && /^\s*!?\s*(command[-_ ]?log|audit[-_ ]?log|show\s+log)\b/i.test(msg.text)) {
        await reply(msg.channelId, "Refused: the command log is only readable from the dashboard.");
        return;
      }

      const key = bindingKey({ platform, channelId: msg.channelId, threadId: msg.threadId });

      // Team-controls chokepoint (X11): every action-bearing request passes
      // through `authorizeRequest` BEFORE any session is spawned or driven.
      if (team) {
        const existing = store.get(key);
        const gate = team.authorizeRequest({
          author: {
            id: msg.userId,
            ...(msg.bot === true ? { isBot: true } : {}),
            ...(msg.webhook === true ? { isWebhook: true } : {}),
            ...(msg.roleIds ? { roleIds: msg.roleIds } : {}),
          },
          channelId: msg.channelId,
          ...(msg.threadId ? { threadId: msg.threadId } : {}),
          verb: existing ? "send_prompt" : "spawn_session",
          ...(existing ? { targetCwd: existing.cwd, target: existing.sessionId } : {}),
        });
        if (gate.kind === "refusal") {
          await reply(msg.channelId, `Refused: ${gate.reason}.`);
          return;
        }
      }

      const binding = await ensureBinding(msg, key);
      if (!binding || !binding.sessionId) return; // spawn pending; resolution binds it

      const live = seam.listSessions().some((s) => s.id === binding.sessionId);
      if (!live) {
        // 4.3: an ENDED session is resumed (continue); a live-but-disconnected
        // one is genuinely unreachable and produces the in-channel error (X1).
        const handled = await resumeIn(msg, key, binding);
        if (!handled) {
          await reply(msg.channelId, "That session is unreachable (no bridge connection)."); // X1
        }
        return;
      }

      const steer = shouldSteer(msg.text, config.steerPrefix);
      const text = stripSteerPrefix(msg.text, config.steerPrefix);
      // Provenance (X24): persisted, plugin-owned — never the user tag namespace.
      lastInvoker.set(binding.sessionId, msg.userId);
      if (team) {
        seam.assignSessionRef(binding.sessionId, {
          kind: "chat-gateway-team",
          principal: msg.userId,
          channelId: msg.channelId,
          workspaceId: team.bindingFor(msg.channelId)?.workspaceId,
        });
      }
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
        // F8: a NEW assistant turn resets the message sequence. Within a turn
        // the accumulated text grows monotonically; a value that is not an
        // extension of what we have is a fresh turn, so turn 2 must not edit
        // turn 1's message (and orphan its overflow chunks).
        if (st.text !== "" && !text.startsWith(st.text)) {
          st.messageIds = [];
          st.text = "";
          st.typing = false;
          st.throttle.dispose();
        }
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
        if (control.kind === "multiselect" || control.kind === "batch") {
          beginSequence(control, sessionId, channelId, store.get(key)?.isDM === true);
          return;
        }
        void adapter
          .sendInteractive(channelId, toInteractivePrompt(control))
          .then(({ messageId }) => {
            prompts.set(control.requestId, {
              sessionId,
              channelId,
              messageId,
              isDM: store.get(key)?.isDM === true,
              invoker: lastInvoker.get(sessionId),
            });
          })
          .catch((err) => seam.log("error", `prompt render failed: ${String(err)}`));
        return;
      }

      if (type === "prompt_dismiss" || type === "prompt_cancel") {
        const promptId = (frame as Record<string, unknown>).promptId;
        if (typeof promptId !== "string") return;
        // F2: a multiselect/batch is dismissed by its ROOT id, which no sub-
        // prompt registers; drop the whole sequence without a further response.
        if (sequences.has(promptId)) {
          dropSequence(promptId);
          return;
        }
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
        for (const [rid, seq] of sequences) {
          if (seq.sessionId === sessionId) dropSequence(rid);
        }
      }
    },

    status() {
      return {
        running,
        boundChannels: store.all().length,
        pendingSpawns: pendingSpawns.size,
        pairingCode: pairing.currentCode(),
      };
    },
  };

  return gateway;
}
