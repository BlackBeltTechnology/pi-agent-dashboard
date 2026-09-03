/**
 * The advertised MCP tool surface: a curated allowlist over
 * `ServerPluginContext` (design.md Decision 1).
 *
 * `GENERATED_VERBS` (73 entries) is far too wide — most are UI-shaped
 * (`reorder_pinned_dirs`, `set_session_process_drawer`) or transport plumbing
 * (`subscribe`, `watch_files`, `worktree_init_subscribe`). Selecting a subset of
 * the 19-member plugin context is still a hand-maintained allowlist, just a far
 * smaller and better-typed one — which is precisely why the completeness check
 * below is REQUIRED rather than avoided.
 *
 * The partition is total: 5 allowlisted + 14 denied = 19 members. A future
 * context member belongs to neither list, so `assertContextPartitionTotal`
 * fails and the omission is caught instead of silently un-triaged.
 */
import type { McpCaller } from "./tokens.js";

/** Every member of `ServerPluginContext`, as of the 19-member interface. */
export const ALL_CONTEXT_MEMBERS = [
  "fastify",
  "sessionManager",
  "eventStore",
  "broadcastToSubscribers",
  "registerPiHandler",
  "registerBrowserHandler",
  "onEvent",
  "onSessionEnded",
  "sendToSession",
  "emitEventToSession",
  "spawnSession",
  "abortSession",
  "abortSpawnedRun",
  "provide",
  "consume",
  "consumeAll",
  "getPluginConfig",
  "updatePluginConfig",
  "logger",
] as const;

/**
 * Members reachable through the MCP surface.
 *
 * `onEvent` is here because `subscriptions/listen` is built on it — it is a
 * protocol method rather than a `tools/list` entry, but it is still an exposed
 * capability and must be accounted for by the partition.
 */
export const ALLOWLISTED_CONTEXT_MEMBERS = [
  "sessionManager",
  "sendToSession",
  "spawnSession",
  "abortSession",
  "onEvent",
] as const;

/**
 * Members that must never be reachable. Each entry is a decision, not an
 * oversight:
 *
 * - `fastify` — the raw server instance; would let a caller mount routes.
 * - `registerPiHandler` / `registerBrowserHandler` — install message handlers.
 * - `broadcastToSubscribers` / `emitEventToSession` — forge events that clients
 *   and sessions would treat as server-originated.
 * - `eventStore` — bulk history read across every session.
 * - `provide` / `consume` / `consumeAll` — the inter-plugin service bus.
 * - `onSessionEnded` — a lifecycle hook, not a verb.
 * - `abortSpawnedRun` — hard-kills *plugin-spawned* runs only; wrong shape for
 *   a general tool, and the reason Decision 13 leaves MCP without a kill ladder.
 * - `getPluginConfig` — leaks server-side configuration.
 * - `updatePluginConfig` — privilege escalation via configuration write.
 * - `logger` — not a verb; exposing it would let a caller forge the very log
 *   lines G5 relies on to make refusals observable.
 */
export const DENIED_CONTEXT_MEMBERS = [
  "fastify",
  "eventStore",
  "broadcastToSubscribers",
  "registerPiHandler",
  "registerBrowserHandler",
  "onSessionEnded",
  "emitEventToSession",
  "abortSpawnedRun",
  "provide",
  "consume",
  "consumeAll",
  "getPluginConfig",
  "updatePluginConfig",
  "logger",
] as const;

/** Verbs from `GENERATED_VERBS` that must never appear (E21). */
export const FORBIDDEN_VERB_NAMES = [
  // UI-only.
  "reorder_pinned_dirs",
  "set_session_process_drawer",
  // Transport plumbing.
  "subscribe",
  "watch_files",
  "worktree_init_subscribe",
] as const;

export interface McpToolDef {
  name: string;
  description: string;
  /** The `ServerPluginContext` member this tool is backed by. */
  contextMember: (typeof ALLOWLISTED_CONTEXT_MEMBERS)[number];
  /** JSON Schema for `tools/call` arguments. */
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    additionalProperties: false;
  };
  /**
   * Whether the tool takes a target session and can therefore self-target.
   * Drives the Req 6 guard; see `guard.ts` `SESSION_TARGETING_TOOLS`.
   */
  targetsSession: boolean;
}

const SESSION_ID_ARG = {
  sessionId: {
    type: "string",
    description:
      "Id of the session to act on. An ordinary argument — there is no connection-scoped session state to fall back to (SEP-2567).",
  },
} as const;

/**
 * The advertised table. `sessionId` is an ordinary required argument on every
 * session-targeting tool: revision 2026-07-28 removed protocol sessions, so a
 * server needing cross-call state passes explicit server-minted handles as tool
 * arguments (E26).
 */
export const MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: "list_sessions",
    description: "List every session the dashboard knows about.",
    contextMember: "sessionManager",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    targetsSession: false,
  },
  {
    name: "send_prompt",
    description:
      "Send prompt text to a session. Text beginning with '/' is routed to extension-command dispatch by the receiving session.",
    contextMember: "sendToSession",
    inputSchema: {
      type: "object",
      properties: {
        ...SESSION_ID_ARG,
        text: { type: "string", description: "The prompt text to deliver." },
      },
      required: ["sessionId", "text"],
      additionalProperties: false,
    },
    targetsSession: true,
  },
  {
    name: "spawn_session",
    description: "Spawn a new pi session. Subject to the first-party trust gate.",
    contextMember: "spawnSession",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Working directory for the new session." },
      },
      required: ["cwd"],
      additionalProperties: false,
    },
    targetsSession: false,
  },
  {
    name: "abort",
    description:
      "Abort the running turn of a session. Soft abort only — returns false when the session's bridge is disconnected, so a no-op is never reported as success.",
    contextMember: "abortSession",
    inputSchema: {
      type: "object",
      properties: { ...SESSION_ID_ARG },
      required: ["sessionId"],
      additionalProperties: false,
    },
    targetsSession: true,
  },
];

/** A handler resolver: given a tool name, produce its invocable handler. */
export type ToolHandlerResolver = (name: string) => ((...args: never[]) => unknown) | undefined;

export interface CompletenessResult {
  ok: boolean;
  /** Advertised tools with no invocable handler. */
  missing: string[];
}

/**
 * Assert every advertised tool resolves to an invocable handler (E22).
 *
 * This exists because of the `denylist.ts` lesson: naive codegen "would emit a
 * WS helper that silently fails" — an advertised-but-dead tool is worse than an
 * absent one, because a client believes the call landed.
 *
 * Deliberately parameterised over both the table and the resolver so a fixture
 * can feed it a deliberately unresolvable entry and prove the check FAILS
 * (E23). A check that cannot be made to fail proves nothing.
 */
export function checkToolCompleteness(
  tools: readonly McpToolDef[],
  resolve: ToolHandlerResolver,
): CompletenessResult {
  const missing = tools.filter((t) => typeof resolve(t.name) !== "function").map((t) => t.name);
  return { ok: missing.length === 0, missing };
}

export interface PartitionResult {
  ok: boolean;
  /** Members in neither list — a new context member nobody triaged. */
  unclassified: string[];
  /** Members in both lists — a contradiction. */
  overlapping: string[];
}

/**
 * Assert the allowlist and denylist together account for every context member,
 * exactly once. Guards the "allowlist drifts from the context" risk: adding a
 * member upstream fails this check rather than quietly defaulting to exposed or
 * to forgotten.
 */
export function assertContextPartitionTotal(
  all: readonly string[] = ALL_CONTEXT_MEMBERS,
  allowed: readonly string[] = ALLOWLISTED_CONTEXT_MEMBERS,
  denied: readonly string[] = DENIED_CONTEXT_MEMBERS,
): PartitionResult {
  const allowedSet = new Set(allowed);
  const deniedSet = new Set(denied);
  const unclassified = all.filter((m) => !allowedSet.has(m) && !deniedSet.has(m));
  const overlapping = all.filter((m) => allowedSet.has(m) && deniedSet.has(m));
  return { ok: unclassified.length === 0 && overlapping.length === 0, unclassified, overlapping };
}

/** The `tools/list` wire payload — never leaks `contextMember`. */
export function listTools(tools: readonly McpToolDef[] = MCP_TOOLS) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/** Look up an advertised tool by name. */
export function findTool(
  name: unknown,
  tools: readonly McpToolDef[] = MCP_TOOLS,
): McpToolDef | undefined {
  return typeof name === "string" ? tools.find((t) => t.name === name) : undefined;
}

/** Re-exported for handler signatures that need the resolved caller. */
export type { McpCaller };
