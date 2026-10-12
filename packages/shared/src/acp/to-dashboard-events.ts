/**
 * Stateful per-session adapter: ACP v2 updates → pi-shaped `DashboardEvent`s.
 *
 * The emitted `eventType` / `data` shapes are exactly what the existing client
 * reducer (`event-reducer.ts`) and the server extractors
 * (`event-status-extraction.ts`) consume, so ACP sessions render with no
 * reducer change. Rules: design D7 / spec "Synthesis of pi-shaped dashboard
 * events".
 *
 * Segment model: all thoughts/messages between segment boundaries (tool-call
 * start, `requires_action`, idle, user message) fold into ONE pi assistant
 * message (thinking + text blocks), independent of ACP `messageId`s.
 *
 * See change: add-acp-session-driver (acp-update-model).
 */

import type { DashboardEvent } from "../types.js";
import {
  type AcpConfigOption,
  type AcpContentBlock,
  type AcpMessage,
  type AcpSessionState,
  type AcpToolCall,
  type AcpToolContent,
  type AcpUpdate,
  applyUpdate,
  createAcpSessionState,
} from "./update-model.js";

/** Counts of updates that deliberately produce no chat event. */
export interface AcpDropCounters {
  usage: number;
  commands: number;
  sessionInfo: number;
  /** Terminal output/updates not referenced by a live tool call. */
  unreferencedTerminal: number;
  /** Config options that are neither `model` nor `thought_level`. */
  configOther: number;
  unknown: number;
}

export interface DashboardEventAdapter {
  /** Feed one v2 update; returns the dashboard events it produced (may be empty). */
  push(update: AcpUpdate): DashboardEvent[];
  /** Mark a user `messageId` whose echo must not produce user-turn events. */
  suppressUserMessage(messageId: string): void;
  /** Flush buffered user chunks (call at a quiescent point, e.g. before reporting). */
  flush(): DashboardEvent[];
  /** Current accumulated ACP state (commands, title, config options, …). */
  getState(): AcpSessionState;
  counters(): Readonly<AcpDropCounters>;
}

export interface DashboardEventAdapterOptions {
  /** Configured agent id — model provider becomes `acp:<agentId>`. */
  agentId: string;
  now?: () => number;
}

type PiStopReason = "stop" | "aborted" | "length" | "error" | "toolUse";

const STOP_MAP: Record<string, { stopReason: PiStopReason; errorMessage?: string }> = {
  end_turn: { stopReason: "stop" },
  cancelled: { stopReason: "aborted" },
  max_tokens: { stopReason: "length" },
  max_turn_requests: { stopReason: "length" },
  refusal: { stopReason: "error", errorMessage: "Agent refused" },
};

function errorText(error: unknown): string {
  const msg = (error as { message?: unknown } | null | undefined)?.message;
  return typeof msg === "string" ? msg : "Agent error";
}

/** ACP stop reason → pi vocabulary (+ error text, + original for unknown values). */
export function mapStopReason(
  stopReason: string | null | undefined,
  error?: unknown,
): { stopReason: PiStopReason; errorMessage?: string; acpStopReason?: string } {
  if (stopReason === undefined || stopReason === null) return { stopReason: "stop" };
  if (stopReason === "error") return { stopReason: "error", errorMessage: errorText(error) };
  const known = Object.hasOwn(STOP_MAP, stopReason) ? STOP_MAP[stopReason] : undefined;
  return known ?? { stopReason: "stop", acpStopReason: stopReason };
}

/** One ACP block → pi user content block (text / image / resource link as text). */
function toPiBlock(b: AcpContentBlock): Record<string, unknown> | undefined {
  if (b.type === "text" && typeof b.text === "string") return { type: "text", text: b.text };
  if (b.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string") {
    return { type: "image", data: b.data, mimeType: b.mimeType };
  }
  if (b.type !== "resource_link") return undefined;
  const label = typeof b.name === "string" ? b.name : typeof b.uri === "string" ? b.uri : "resource";
  return { type: "text", text: typeof b.uri === "string" ? `[${label}](${b.uri})` : label };
}

/** pi user-message content from ACP blocks; adjacent text blocks are merged. */
export function toPiUserContent(blocks: readonly AcpContentBlock[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    const b = toPiBlock(block);
    const last = out.at(-1);
    if (b?.type === "text" && last?.type === "text") last.text = `${last.text as string}${b.text as string}`;
    else if (b) out.push(b);
  }
  return out;
}

/** `message_start` + `message_end` for a user turn (also used for dashboard-originated prompts). */
export function userMessageEvents(
  content: readonly AcpContentBlock[] | string,
  timestamp: number,
): DashboardEvent[] {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : toPiUserContent(content);
  const message = { role: "user", content: blocks, timestamp };
  return [
    { eventType: "message_start", timestamp, data: { message } },
    { eventType: "message_end", timestamp, data: { message } },
  ];
}

const textOf = (blocks: readonly AcpContentBlock[]): string =>
  blocks.map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");

interface Part {
  messageId: string;
  kind: "text" | "thinking";
  text: string;
}

interface ToolTrack {
  ended: boolean;
  lastText: string;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}

function diffText(c: AcpToolContent): string[] {
  if (typeof c.path === "string") return [`diff: ${c.path}`];
  if (!Array.isArray(c.changes)) return [];
  return (c.changes as Array<Record<string, unknown>>)
    .filter((ch) => typeof ch?.operation === "string" && typeof ch.path === "string")
    .map((ch) => `${ch.operation} ${ch.path}`);
}

function contentItemText(c: AcpToolContent, state: AcpSessionState): string[] {
  if (c.type === "diff") return diffText(c);
  if (c.type === "terminal") {
    const out = typeof c.terminalId === "string" ? state.terminals.get(c.terminalId)?.output : undefined;
    return out ? [out] : [];
  }
  if (c.type !== "content" || typeof c.content !== "object" || c.content === null) return [];
  const b = c.content as AcpContentBlock;
  if (b.type === "text" && typeof b.text === "string") return [b.text];
  return b.type === "image" ? ["[image]"] : [];
}

function toolText(tc: AcpToolCall, state: AcpSessionState): string {
  const parts = tc.content.flatMap((c) => contentItemText(c, state));
  if (parts.length === 0 && tc.rawOutput !== undefined) parts.push(stringify(tc.rawOutput));
  return parts.join("\n");
}

function toolImages(tc: AcpToolCall): Array<{ data: string; mimeType: string }> {
  const out: Array<{ data: string; mimeType: string }> = [];
  for (const c of tc.content) {
    const b = c.type === "content" ? (c.content as AcpContentBlock | undefined) : undefined;
    if (b?.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string") {
      out.push({ data: b.data, mimeType: b.mimeType });
    }
  }
  return out;
}

const referencedTerminalIds = (tc: AcpToolCall): string[] =>
  tc.content.flatMap((c) => (c.type === "terminal" && typeof c.terminalId === "string" ? [c.terminalId] : []));

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

const toolNameOf = (tc: AcpToolCall): string => tc.name ?? tc.title ?? tc.toolKind ?? "tool";

function toolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return raw === undefined ? {} : { input: raw };
}

export function createDashboardEventAdapter(opts: DashboardEventAdapterOptions): DashboardEventAdapter {
  const now = opts.now ?? Date.now;
  let state = createAcpSessionState();
  const counters: AcpDropCounters = {
    usage: 0,
    commands: 0,
    sessionInfo: 0,
    unreferencedTerminal: 0,
    configOther: 0,
    unknown: 0,
  };

  const suppressed = new Set<string>();
  const emittedUser = new Set<string>();
  let userBuf: string | undefined;

  // assistant segment
  let parts: Part[] = [];
  let segmentStarted = false;
  let openThinking = -1; // index into parts, -1 = none

  // turn
  let inTurn = false;
  let prompting = false;
  let turnMessages: Array<Record<string, unknown>> = [];

  const tools = new Map<string, ToolTrack>();
  const lastConfig = new Map<string, unknown>();
  const lastPlan = new Map<string, string>();

  const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
    eventType,
    timestamp: now(),
    data,
  });

  const snapshot = (): Record<string, unknown> => ({
    role: "assistant",
    content: parts.map((p) => (p.kind === "text" ? { type: "text", text: p.text } : { type: "thinking", thinking: p.text })),
    timestamp: now(),
  });

  const update = (out: DashboardEvent[], assistantMessageEvent?: Record<string, unknown>) =>
    out.push(ev("message_update", { message: snapshot(), ...(assistantMessageEvent ? { assistantMessageEvent } : {}) }));

  function closeThinking(out: DashboardEvent[]): void {
    if (openThinking < 0) return;
    const idx = openThinking;
    openThinking = -1;
    update(out, { type: "thinking_end", contentIndex: idx, content: parts[idx]?.text ?? "" });
  }

  /** Close the open assistant segment. Returns the finalized message, or null if none was open. */
  function closeSegment(
    out: DashboardEvent[],
    reason: PiStopReason,
    errorMessage?: string,
  ): Record<string, unknown> | null {
    if (!segmentStarted) return null;
    closeThinking(out);
    const message = { ...snapshot(), stopReason: reason, ...(errorMessage ? { errorMessage } : {}) };
    out.push(ev("message_end", { message }));
    turnMessages.push(message);
    parts = [];
    segmentStarted = false;
    return message;
  }

  function startTurn(out: DashboardEvent[]): void {
    if (inTurn) return;
    inTurn = true;
    turnMessages = [];
    out.push(ev("agent_start", {}));
  }

  function endPrompt(out: DashboardEvent[]): void {
    if (!prompting) return;
    prompting = false;
    out.push(ev("ui_prompt_end", { source: "acp" }));
  }

  function emitUser(out: DashboardEvent[], id: string): void {
    if (suppressed.has(id) || emittedUser.has(id)) return;
    const msg: AcpMessage | undefined = state.messages.get(id);
    if (!msg || msg.content.length === 0) return;
    emittedUser.add(id);
    closeSegment(out, "stop");
    out.push(...userMessageEvents(msg.content, now()));
  }

  function flushUser(out: DashboardEvent[]): void {
    if (userBuf === undefined) return;
    const id = userBuf;
    userBuf = undefined;
    emitUser(out, id);
  }

  // ---- assistant text / thinking

  function openSegment(out: DashboardEvent[]): void {
    if (segmentStarted) return;
    segmentStarted = true;
    out.push(ev("message_start", { message: { role: "assistant", content: [], timestamp: now() } }));
  }

  /** Index of the part to write to (created if needed); opens the thinking block when needed. */
  function targetPart(out: DashboardEvent[], messageId: string, kind: Part["kind"]): number {
    let idx = parts.findIndex((p) => p.messageId === messageId && p.kind === kind);
    if (openThinking >= 0 && openThinking !== idx) closeThinking(out);
    if (idx < 0) {
      parts.push({ messageId, kind, text: "" });
      idx = parts.length - 1;
    }
    if (kind === "thinking" && openThinking !== idx) {
      openThinking = idx;
      update(out, { type: "thinking_start", contentIndex: idx });
    }
    return idx;
  }

  function agentContent(out: DashboardEvent[], messageId: string, kind: Part["kind"]): void {
    const msg = state.messages.get(messageId);
    const full = msg ? textOf(msg.content) : "";
    const existing = parts.find((p) => p.messageId === messageId && p.kind === kind);
    if (full === (existing?.text ?? "")) return;

    openSegment(out);
    const idx = targetPart(out, messageId, kind);
    const part = parts[idx] as Part;
    const delta = full.startsWith(part.text) ? full.slice(part.text.length) : null;
    part.text = full;
    if (delta === null) update(out);
    else update(out, { type: kind === "thinking" ? "thinking_delta" : "text_delta", contentIndex: idx, delta });
  }

  // ---- tools

  function startTool(out: DashboardEvent[], tc: AcpToolCall): ToolTrack {
    closeSegment(out, "toolUse");
    startTurn(out);
    const track: ToolTrack = { ended: false, lastText: "" };
    tools.set(tc.toolCallId, track);
    out.push(
      ev("tool_execution_start", { toolCallId: tc.toolCallId, toolName: toolNameOf(tc), args: toolArgs(tc.rawInput) }),
    );
    return track;
  }

  function finishTool(out: DashboardEvent[], tc: AcpToolCall, text: string, forcedError?: boolean): void {
    const track = tools.get(tc.toolCallId);
    if (!track || track.ended) return;
    track.ended = true;
    const isError = forcedError ?? (tc.status === "failed" || tc.status === "cancelled");
    const images = toolImages(tc);
    out.push(
      ev("tool_execution_end", {
        toolCallId: tc.toolCallId,
        toolName: toolNameOf(tc),
        result: text,
        isError,
        ...(images.length > 0 ? { images } : {}),
      }),
    );
  }

  function toolActivity(out: DashboardEvent[], toolCallId: string): void {
    const tc = state.toolCalls.get(toolCallId);
    if (!tc) return;
    const track = tools.get(toolCallId) ?? startTool(out, tc);
    if (track.ended) return;
    const text = toolText(tc, state);
    if (tc.status && TERMINAL_STATUSES.has(tc.status)) {
      finishTool(out, tc, text);
    } else if (text !== "" && text !== track.lastText) {
      track.lastText = text;
      out.push(
        ev("tool_execution_update", {
          toolCallId,
          toolName: toolNameOf(tc),
          partialResult: { content: [{ type: "text", text }] },
        }),
      );
    }
  }

  function terminalActivity(out: DashboardEvent[], terminalId: string): void {
    let folded = false;
    for (const [id, track] of tools) {
      const tc = track.ended ? undefined : state.toolCalls.get(id);
      if (tc && referencedTerminalIds(tc).includes(terminalId)) {
        folded = true;
        toolActivity(out, id);
      }
    }
    if (!folded) counters.unreferencedTerminal += 1;
  }

  // ---- turn lifecycle

  function closeOpenTools(out: DashboardEvent[], cancelled: boolean): void {
    for (const [id, track] of tools) {
      const tc = track.ended ? undefined : state.toolCalls.get(id);
      if (tc) finishTool(out, tc, toolText(tc, state) || (cancelled ? "Cancelled" : ""), cancelled);
    }
  }

  function finishTurn(out: DashboardEvent[], stopReason: string | null | undefined, error: unknown): void {
    const mapped = mapStopReason(stopReason, error);
    closeOpenTools(out, stopReason === "cancelled");
    let final = closeSegment(out, mapped.stopReason, mapped.errorMessage);
    if (!final) {
      final = {
        role: "assistant",
        content: [],
        timestamp: now(),
        stopReason: mapped.stopReason,
        ...(mapped.errorMessage ? { errorMessage: mapped.errorMessage } : {}),
      };
      turnMessages.push(final);
    }
    const extra = mapped.acpStopReason ? { acpStopReason: mapped.acpStopReason } : {};
    out.push(ev("turn_end", { message: final, ...extra }));
    out.push(ev("agent_end", { messages: turnMessages, ...extra }));
    out.push(ev("agent_settled", {}));
    inTurn = false;
    turnMessages = [];
    // Bound memory: a finished turn's accumulated messages / tool calls / terminal
    // output are no longer needed (everything was emitted). Config options,
    // commands, title and plans stay. See change: add-acp-session-driver (D13).
    state = { ...state, messages: new Map(), toolCalls: new Map(), terminals: new Map() };
    // `tools` is deliberately NOT cleared: a late update for a finished tool must
    // not re-emit tool_execution_start (toolCallIds are unique per session).
  }

  function onState(out: DashboardEvent[], u: Extract<AcpUpdate, { kind: "state_update" }>): void {
    if (u.state === "running") {
      endPrompt(out);
      startTurn(out);
    } else if (u.state === "requires_action") {
      startTurn(out);
      closeSegment(out, "toolUse");
      if (!prompting) out.push(ev("ui_prompt_start", { source: "acp" }));
      prompting = true;
    } else {
      endPrompt(out);
      if (inTurn) finishTurn(out, u.stopReason, u.error);
      else closeSegment(out, "stop");
    }
  }

  // ---- config / plan

  function configEvent(o: AcpConfigOption): DashboardEvent | undefined {
    if (o.category === "model") {
      return ev("model_select", { model: { provider: `acp:${opts.agentId}`, id: String(o.currentValue) } });
    }
    if (o.category === "thought_level") return ev("model_select", { thinkingLevel: String(o.currentValue) });
    counters.configOther += 1;
    return undefined;
  }

  function onConfig(out: DashboardEvent[], options: readonly AcpConfigOption[]): void {
    for (const o of options) {
      if (lastConfig.has(o.configId) && lastConfig.get(o.configId) === o.currentValue) continue;
      lastConfig.set(o.configId, o.currentValue);
      const e = configEvent(o);
      if (e) out.push(e);
    }
  }

  function onPlan(out: DashboardEvent[], u: Extract<AcpUpdate, { kind: "plan_update" }>): void {
    const sig = JSON.stringify([u.type, u.entries ?? u.content]);
    if (lastPlan.get(u.planId) === sig) return;
    lastPlan.set(u.planId, sig);
    out.push(ev("acp_plan_update", { planId: u.planId, type: u.type, entries: u.entries ?? [] }));
  }

  function dispatch(out: DashboardEvent[], u: AcpUpdate): void {
    switch (u.kind) {
      case "user_message":
        return emitUser(out, u.messageId);
      case "user_message_chunk":
        userBuf = suppressed.has(u.messageId) ? userBuf : u.messageId;
        return;
      case "agent_message":
      case "agent_message_chunk":
        return agentContent(out, u.messageId, "text");
      case "agent_thought":
      case "agent_thought_chunk":
        return agentContent(out, u.messageId, "thinking");
      case "tool_call_update":
      case "tool_call_content_chunk":
        return toolActivity(out, u.toolCallId);
      case "terminal_update":
      case "terminal_output_chunk":
        return terminalActivity(out, u.terminalId);
      case "state_update":
        return onState(out, u);
      case "config_option_update":
        return onConfig(out, u.options);
      case "plan_update":
        return onPlan(out, u);
      case "usage_update":
        counters.usage += 1;
        return;
      case "available_commands_update":
        counters.commands += 1;
        return;
      case "session_info_update":
        counters.sessionInfo += 1;
        return;
      case "unknown":
        counters.unknown += 1;
        return;
    }
  }

  function push(u: AcpUpdate): DashboardEvent[] {
    const out: DashboardEvent[] = [];
    if (userBuf !== undefined && !(u.kind === "user_message_chunk" && u.messageId === userBuf)) flushUser(out);
    state = applyUpdate(state, u);
    dispatch(out, u);
    return out;
  }

  return {
    push,
    suppressUserMessage: (id) => {
      suppressed.add(id);
      if (userBuf === id) userBuf = undefined;
    },
    flush() {
      const out: DashboardEvent[] = [];
      flushUser(out);
      return out;
    },
    getState: () => state,
    counters: () => ({ ...counters }),
  };
}
