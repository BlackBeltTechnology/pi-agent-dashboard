/**
 * Typed ACP v2 session-update model + upsert reducer.
 *
 * Single v1/v2 normalisation point (see `normalize-v1.ts`). Hand-written
 * narrowing of the Draft v2 `SessionUpdate` schema (`@agentclientprotocol/sdk`
 * `experimental/v2`) — no runtime dependency outside `packages/shared`.
 *
 * - `parseSessionUpdate` never throws: malformed / unknown payloads become
 *   `{ kind: "unknown", raw }` with the original object untouched.
 * - `applyUpdate` is a pure upsert reducer keyed by `messageId` /
 *   `toolCallId` / `planId` / `terminalId`: an OMITTED field leaves the value
 *   unchanged, `null` clears it, a concrete value replaces it; chunk variants
 *   append to the entity with the matching id.
 *
 * Patch-field presence is encoded by key presence on the parsed update
 * (`"title" in update`), so `null` and "omitted" stay distinguishable.
 *
 * See change: add-acp-session-driver (acp-update-model).
 */

/** An ACP content block (`text`, `image`, `resource_link`, … open enum). */
export interface AcpContentBlock {
  type: string;
  [key: string]: unknown;
}

/** An ACP tool-call content item (`content`, `diff`, `terminal`, … open enum). */
export interface AcpToolContent {
  type: string;
  [key: string]: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: string;
  status?: string;
}

export interface AcpConfigOption {
  configId: string;
  name?: string;
  /** `mode` | `model` | `thought_level` | `_custom` … */
  category?: string | null;
  type: string;
  currentValue: unknown;
  options?: Array<{ value: string; name: string; description?: string | null }>;
}

export interface AcpCommand {
  name: string;
  description?: string;
}

/** Turn state of the foreground run. */
export type AcpRunState = "running" | "idle" | "requires_action";

export type AcpUpdate =
  | { kind: "user_message"; messageId: string; content?: AcpContentBlock[] | null }
  | { kind: "user_message_chunk"; messageId: string; content: AcpContentBlock }
  | { kind: "agent_message"; messageId: string; content?: AcpContentBlock[] | null }
  | { kind: "agent_message_chunk"; messageId: string; content: AcpContentBlock }
  | { kind: "agent_thought"; messageId: string; content?: AcpContentBlock[] | null }
  | { kind: "agent_thought_chunk"; messageId: string; content: AcpContentBlock }
  | {
      kind: "tool_call_update";
      toolCallId: string;
      /** Patch fields: key absent = unchanged, `null` = clear. */
      name?: string | null;
      title?: string | null;
      toolKind?: string | null;
      status?: string | null;
      content?: AcpToolContent[] | null;
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | { kind: "tool_call_content_chunk"; toolCallId: string; content: AcpToolContent }
  | { kind: "state_update"; state: AcpRunState; stopReason?: string | null; error?: unknown }
  | {
      kind: "plan_update";
      planId: string;
      /** `items` carries `entries`; other plan types keep the raw plan in `content`. */
      type: string;
      entries?: AcpPlanEntry[];
      content?: unknown;
    }
  | { kind: "config_option_update"; options: AcpConfigOption[] }
  | { kind: "available_commands_update"; commands: AcpCommand[] }
  | {
      kind: "usage_update";
      used: number;
      size: number;
      cost?: { amount: number; currency: string } | null;
    }
  | { kind: "session_info_update"; title?: string | null; updatedAt?: string | null }
  | {
      kind: "terminal_update";
      terminalId: string;
      command?: string | null;
      cwd?: string | null;
      /** Authoritative replacement snapshot (base64 bytes) of the output. */
      output?: { data: string } | null;
      exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
    }
  | { kind: "terminal_output_chunk"; terminalId: string; data: string }
  | { kind: "unknown"; raw: unknown };

export type AcpUpdateKind = AcpUpdate["kind"];

// ---------------------------------------------------------------- parsing

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBlock = (v: unknown): v is AcpContentBlock => isRec(v) && isStr(v.type);

/** `undefined` (key absent) | `null` | valid → ok; anything else → bad. */
function optPatch<T>(
  raw: Rec,
  key: string,
  guard: (v: unknown) => v is T,
): { ok: true; present: boolean; value: T | null | undefined } | { ok: false } {
  if (!(key in raw) || raw[key] === undefined) return { ok: true, present: false, value: undefined };
  const v = raw[key];
  if (v === null) return { ok: true, present: true, value: null };
  return guard(v) ? { ok: true, present: true, value: v } : { ok: false };
}

const isBlockArray = (v: unknown): v is AcpContentBlock[] => Array.isArray(v) && v.every(isBlock);

function parseMessage(
  kind: "user_message" | "agent_message" | "agent_thought",
  raw: Rec,
): AcpUpdate | undefined {
  if (!isStr(raw.messageId)) return undefined;
  const content = optPatch(raw, "content", isBlockArray);
  if (!content.ok) return undefined;
  const out: Extract<AcpUpdate, { kind: typeof kind }> = { kind, messageId: raw.messageId };
  if (content.present) out.content = content.value as AcpContentBlock[] | null;
  return out;
}

function parseChunk(
  kind: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  raw: Rec,
): AcpUpdate | undefined {
  if (!isStr(raw.messageId) || !isBlock(raw.content)) return undefined;
  return { kind, messageId: raw.messageId, content: raw.content };
}

const TOOL_PATCH_FIELDS = [
  ["name", "name"],
  ["title", "title"],
  ["status", "status"],
  ["kind", "toolKind"],
] as const;

function parseToolCall(raw: Rec): AcpUpdate | undefined {
  if (!isStr(raw.toolCallId)) return undefined;
  const out: Extract<AcpUpdate, { kind: "tool_call_update" }> = {
    kind: "tool_call_update",
    toolCallId: raw.toolCallId,
  };
  for (const [wire, field] of TOOL_PATCH_FIELDS) {
    const p = optPatch(raw, wire, isStr);
    if (!p.ok) return undefined;
    if (p.present) out[field] = p.value as string | null;
  }
  const c = optPatch(raw, "content", (v): v is AcpToolContent[] => Array.isArray(v) && v.every(isBlock));
  if (!c.ok) return undefined;
  if (c.present) out.content = c.value as AcpToolContent[] | null;
  if (raw.rawInput !== undefined) out.rawInput = raw.rawInput;
  if (raw.rawOutput !== undefined) out.rawOutput = raw.rawOutput;
  return out;
}

function parsePlanEntry(e: unknown): AcpPlanEntry | undefined {
  if (!isRec(e) || !isStr(e.content)) return undefined;
  return {
    content: e.content,
    ...(isStr(e.priority) ? { priority: e.priority } : {}),
    ...(isStr(e.status) ? { status: e.status } : {}),
  };
}

function parsePlan(raw: Rec): AcpUpdate | undefined {
  const plan = raw.plan;
  if (!isRec(plan) || !isStr(plan.type) || !isStr(plan.planId)) return undefined;
  if (plan.type !== "items") return { kind: "plan_update", planId: plan.planId, type: plan.type, content: plan };
  if (!Array.isArray(plan.entries)) return undefined;
  const entries = plan.entries.map(parsePlanEntry);
  if (entries.some((e) => e === undefined)) return undefined;
  return { kind: "plan_update", planId: plan.planId, type: "items", entries: entries as AcpPlanEntry[] };
}

/** Flatten select groups (`{groupId, options:[…]}`) to a single value list. */
function flattenSelectOptions(options: unknown[]): NonNullable<AcpConfigOption["options"]> {
  const flat: NonNullable<AcpConfigOption["options"]> = [];
  for (const item of options) {
    if (!isRec(item)) continue;
    const inner = Array.isArray(item.options) ? item.options : [item];
    for (const v of inner) {
      if (isRec(v) && isStr(v.value) && isStr(v.name)) flat.push({ value: v.value, name: v.name });
    }
  }
  return flat;
}

function parseConfigOption(o: unknown): AcpConfigOption | undefined {
  if (!isRec(o) || !isStr(o.configId) || !isStr(o.type)) return undefined;
  const opt: AcpConfigOption = { configId: o.configId, type: o.type, currentValue: o.currentValue };
  if (isStr(o.name)) opt.name = o.name;
  if (isStr(o.category) || o.category === null) opt.category = o.category as string | null;
  if (Array.isArray(o.options)) opt.options = flattenSelectOptions(o.options);
  return opt;
}

function parseConfigOptions(raw: Rec): AcpUpdate | undefined {
  if (!Array.isArray(raw.configOptions)) return undefined;
  const options = raw.configOptions.map(parseConfigOption);
  if (options.some((o) => o === undefined)) return undefined;
  return { kind: "config_option_update", options: options as AcpConfigOption[] };
}

function parseState(raw: Rec): AcpUpdate | undefined {
  const state = raw.state;
  if (state !== "running" && state !== "idle" && state !== "requires_action") return undefined;
  const out: Extract<AcpUpdate, { kind: "state_update" }> = { kind: "state_update", state };
  if (state !== "idle") return out;
  const stop = optPatch(raw, "stopReason", isStr);
  if (!stop.ok) return undefined;
  if (stop.present || "stopReason" in raw) out.stopReason = (stop.value as string | null | undefined) ?? null;
  if (raw.error !== undefined && raw.error !== null) out.error = raw.error;
  return out;
}

function parseCommands(raw: Rec): AcpUpdate | undefined {
  if (!Array.isArray(raw.availableCommands)) return undefined;
  const commands: AcpCommand[] = [];
  for (const c of raw.availableCommands) {
    if (!isRec(c) || !isStr(c.name)) return undefined;
    commands.push({ name: c.name, ...(isStr(c.description) ? { description: c.description } : {}) });
  }
  return { kind: "available_commands_update", commands };
}

function parseCost(cost: unknown): { amount: number; currency: string } | null | undefined {
  if (cost === null) return null;
  if (isRec(cost) && isNum(cost.amount) && isStr(cost.currency)) return { amount: cost.amount, currency: cost.currency };
  return undefined;
}

function parseUsage(raw: Rec): AcpUpdate | undefined {
  if (!isNum(raw.used) || !isNum(raw.size)) return undefined;
  const out: Extract<AcpUpdate, { kind: "usage_update" }> = { kind: "usage_update", used: raw.used, size: raw.size };
  const cost = parseCost(raw.cost);
  if (cost !== undefined) out.cost = cost;
  return out;
}

function parseSessionInfo(raw: Rec): AcpUpdate | undefined {
  const title = optPatch(raw, "title", isStr);
  const updatedAt = optPatch(raw, "updatedAt", isStr);
  if (!title.ok || !updatedAt.ok) return undefined;
  const out: Extract<AcpUpdate, { kind: "session_info_update" }> = { kind: "session_info_update" };
  if (title.present) out.title = title.value as string | null;
  if (updatedAt.present) out.updatedAt = updatedAt.value as string | null;
  return out;
}

function parseExitStatus(v: unknown): { exitCode?: number | null; signal?: string | null } | null | undefined {
  if (v === null) return null;
  if (!isRec(v)) return undefined;
  const out: { exitCode?: number | null; signal?: string | null } = {};
  if (isNum(v.exitCode) || v.exitCode === null) out.exitCode = v.exitCode;
  if (isStr(v.signal) || v.signal === null) out.signal = v.signal;
  return out;
}

function parseTerminalUpdate(raw: Rec): AcpUpdate | undefined {
  if (!isStr(raw.terminalId)) return undefined;
  const out: Extract<AcpUpdate, { kind: "terminal_update" }> = { kind: "terminal_update", terminalId: raw.terminalId };
  for (const key of ["command", "cwd"] as const) {
    const p = optPatch(raw, key, isStr);
    if (!p.ok) return undefined;
    if (p.present) out[key] = p.value as string | null;
  }
  if (raw.output === null) out.output = null;
  else if (raw.output !== undefined) {
    if (!isRec(raw.output) || !isStr(raw.output.data)) return undefined;
    out.output = { data: raw.output.data };
  }
  if (raw.exitStatus !== undefined) {
    const exit = parseExitStatus(raw.exitStatus);
    if (exit === undefined) return undefined;
    out.exitStatus = exit;
  }
  return out;
}

const parseMessageUpdate = (kind: "user_message" | "agent_message" | "agent_thought") => (raw: Rec) =>
  parseMessage(kind, raw);
const parseChunkUpdate = (kind: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk") => (raw: Rec) =>
  parseChunk(kind, raw);

const PARSERS: Record<string, (raw: Rec) => AcpUpdate | undefined> = {
  user_message: parseMessageUpdate("user_message"),
  agent_message: parseMessageUpdate("agent_message"),
  agent_thought: parseMessageUpdate("agent_thought"),
  user_message_chunk: parseChunkUpdate("user_message_chunk"),
  agent_message_chunk: parseChunkUpdate("agent_message_chunk"),
  agent_thought_chunk: parseChunkUpdate("agent_thought_chunk"),
  tool_call_update: parseToolCall,
  tool_call_content_chunk: (raw) =>
    isStr(raw.toolCallId) && isBlock(raw.content)
      ? { kind: "tool_call_content_chunk", toolCallId: raw.toolCallId, content: raw.content }
      : undefined,
  state_update: parseState,
  plan_update: parsePlan,
  config_option_update: parseConfigOptions,
  available_commands_update: parseCommands,
  usage_update: parseUsage,
  session_info_update: parseSessionInfo,
  terminal_update: parseTerminalUpdate,
  terminal_output_chunk: (raw) =>
    isStr(raw.terminalId) && isStr(raw.data)
      ? { kind: "terminal_output_chunk", terminalId: raw.terminalId, data: raw.data }
      : undefined,
};

/**
 * Parse one v2 `session/update` payload (`{ sessionUpdate, …fields }`).
 * Never throws. Unrecognised variants (including `_`-prefixed extensions and
 * future non-underscore values) and malformed payloads yield
 * `{ kind: "unknown", raw }` carrying the original object unmodified.
 */
export function parseSessionUpdate(raw: unknown): AcpUpdate {
  try {
    if (isRec(raw) && isStr(raw.sessionUpdate)) {
      const parsed = Object.hasOwn(PARSERS, raw.sessionUpdate) ? PARSERS[raw.sessionUpdate]?.(raw) : undefined;
      if (parsed) return parsed;
    }
  } catch {
    // fall through to unknown
  }
  return { kind: "unknown", raw };
}

// ---------------------------------------------------------------- state

export interface AcpMessage {
  messageId: string;
  role: "user" | "agent" | "thought";
  content: AcpContentBlock[];
}

export interface AcpToolCall {
  toolCallId: string;
  name?: string;
  title?: string;
  toolKind?: string;
  status?: string;
  content: AcpToolContent[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpTerminal {
  terminalId: string;
  command?: string;
  cwd?: string;
  /** Decoded output text accumulated from `terminal_output_chunk` / snapshots. */
  output: string;
  exitStatus?: { exitCode?: number | null; signal?: string | null };
}

export interface AcpPlan {
  planId: string;
  type: string;
  entries: AcpPlanEntry[];
  content?: unknown;
}

export interface AcpSessionState {
  messages: ReadonlyMap<string, AcpMessage>;
  toolCalls: ReadonlyMap<string, AcpToolCall>;
  terminals: ReadonlyMap<string, AcpTerminal>;
  plans: ReadonlyMap<string, AcpPlan>;
  configOptions: ReadonlyMap<string, AcpConfigOption>;
  commands: readonly AcpCommand[];
  title?: string;
  run: { state: AcpRunState; stopReason?: string | null };
}

export function createAcpSessionState(): AcpSessionState {
  return {
    messages: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    plans: new Map(),
    configOptions: new Map(),
    commands: [],
    run: { state: "idle" },
  };
}

/**
 * Decode a base64 terminal payload to text (UTF-8). Chunks are independently
 * encoded, so a multi-byte character split across two chunks decodes lossily
 * (U+FFFD) — accepted for chat display. Never throws.
 */
export function decodeTerminalData(data: string): string {
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function upsertMessage(
  state: AcpSessionState,
  role: AcpMessage["role"],
  messageId: string,
  mutate: (prev: AcpContentBlock[]) => AcpContentBlock[],
): AcpSessionState {
  const prev = state.messages.get(messageId);
  const next: AcpMessage = { messageId, role: prev?.role ?? role, content: mutate(prev?.content ?? []) };
  return { ...state, messages: withEntry(state.messages, messageId, next) };
}

const MESSAGE_ROLE = {
  user_message: "user",
  user_message_chunk: "user",
  agent_message: "agent",
  agent_message_chunk: "agent",
  agent_thought: "thought",
  agent_thought_chunk: "thought",
} as const;

type ToolPatch = Partial<Record<string, unknown>>;

const TOOL_STRING_FIELDS = ["name", "title", "toolKind", "status"] as const;

function patchToolCall(prev: AcpToolCall | undefined, toolCallId: string, u: ToolPatch): AcpToolCall {
  const next: AcpToolCall = { ...(prev ?? { toolCallId, content: [] }) };
  for (const field of TOOL_STRING_FIELDS) {
    if (!(field in u)) continue;
    if (u[field] === null) delete next[field];
    else next[field] = u[field] as string;
  }
  if ("content" in u) next.content = (u.content as AcpToolContent[] | null) ?? [];
  for (const key of ["rawInput", "rawOutput"] as const) {
    if (!(key in u)) continue;
    if (u[key] === null) delete next[key];
    else next[key] = u[key];
  }
  return next;
}

type Reducer<K extends AcpUpdateKind> = (state: AcpSessionState, update: Extract<AcpUpdate, { kind: K }>) => AcpSessionState;

const applyMessage: Reducer<"user_message" | "agent_message" | "agent_thought"> = (state, update) => {
  const role = MESSAGE_ROLE[update.kind];
  // Whole-message upsert: content replaces everything accumulated so far.
  if (!("content" in update)) return upsertMessage(state, role, update.messageId, (p) => p);
  return upsertMessage(state, role, update.messageId, () => update.content ?? []);
};

const applyChunk: Reducer<"user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk"> = (state, update) =>
  upsertMessage(state, MESSAGE_ROLE[update.kind], update.messageId, (p) => [...p, update.content]);

const applyToolCall: Reducer<"tool_call_update"> = (state, update) => {
  const { kind: _k, toolCallId, ...patch } = update;
  const next = patchToolCall(state.toolCalls.get(toolCallId), toolCallId, patch);
  return { ...state, toolCalls: withEntry(state.toolCalls, toolCallId, next) };
};

const applyToolChunk: Reducer<"tool_call_content_chunk"> = (state, update) => {
  const next = patchToolCall(state.toolCalls.get(update.toolCallId), update.toolCallId, {});
  next.content = [...next.content, update.content];
  return { ...state, toolCalls: withEntry(state.toolCalls, update.toolCallId, next) };
};

const applyRun: Reducer<"state_update"> = (state, update) => ({
  ...state,
  run: { state: update.state, ...(update.stopReason !== undefined ? { stopReason: update.stopReason } : {}) },
});

const applyPlan: Reducer<"plan_update"> = (state, update) => ({
  ...state,
  plans: withEntry(state.plans, update.planId, {
    planId: update.planId,
    type: update.type,
    entries: update.entries ?? [],
    ...(update.content !== undefined ? { content: update.content } : {}),
  }),
});

const applyConfig: Reducer<"config_option_update"> = (state, update) => {
  const next = new Map(state.configOptions);
  for (const o of update.options) next.set(o.configId, o);
  return { ...state, configOptions: next };
};

const applySessionInfo: Reducer<"session_info_update"> = (state, update) => {
  if (!("title" in update)) return state;
  const { title: _t, ...rest } = state;
  return update.title ? { ...rest, title: update.title } : rest;
};

function patchOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value === null) delete target[key];
  else target[key] = value;
}

const applyTerminalUpdate: Reducer<"terminal_update"> = (state, update) => {
  const next: AcpTerminal = { ...(state.terminals.get(update.terminalId) ?? { terminalId: update.terminalId, output: "" }) };
  if ("command" in update) patchOptional(next, "command", update.command ?? null);
  if ("cwd" in update) patchOptional(next, "cwd", update.cwd ?? null);
  if ("exitStatus" in update) patchOptional(next, "exitStatus", update.exitStatus ?? null);
  if ("output" in update) next.output = update.output ? decodeTerminalData(update.output.data) : "";
  return { ...state, terminals: withEntry(state.terminals, update.terminalId, next) };
};

const applyTerminalChunk: Reducer<"terminal_output_chunk"> = (state, update) => {
  const prev = state.terminals.get(update.terminalId) ?? { terminalId: update.terminalId, output: "" };
  const next = { ...prev, output: prev.output + decodeTerminalData(update.data) };
  return { ...state, terminals: withEntry(state.terminals, update.terminalId, next) };
};

/** Pure upsert reducer. Unknown updates leave state unchanged. */
export function applyUpdate(state: AcpSessionState, update: AcpUpdate): AcpSessionState {
  switch (update.kind) {
    case "user_message":
    case "agent_message":
    case "agent_thought":
      return applyMessage(state, update);
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return applyChunk(state, update);
    case "tool_call_update":
      return applyToolCall(state, update);
    case "tool_call_content_chunk":
      return applyToolChunk(state, update);
    case "state_update":
      return applyRun(state, update);
    case "plan_update":
      return applyPlan(state, update);
    case "config_option_update":
      return applyConfig(state, update);
    case "available_commands_update":
      return { ...state, commands: update.commands };
    case "session_info_update":
      return applySessionInfo(state, update);
    case "terminal_update":
      return applyTerminalUpdate(state, update);
    case "terminal_output_chunk":
      return applyTerminalChunk(state, update);
    case "usage_update":
    case "unknown":
      return state;
  }
}
