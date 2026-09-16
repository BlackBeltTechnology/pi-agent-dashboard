/**
 * The MCP tool surface — shared helpers over the generated manifest
 * (change: expand-mcp-tiered-surface).
 *
 * The advertised table now lives in `tools.manifest.ts` (reviewed) and
 * `generated/tools.ts` (derived). This module keeps the context partition, the
 * tier filter, the completeness check and the wire-shape helper that all of
 * them read.
 *
 * The partition is total over `ServerPluginContext`: allowlisted ∪ denied ∪
 * internal-only = all members. `fastify` is INTERNAL_ONLY — the plugin uses it
 * to run REST-bound tools, but no caller can reach it as a context member.
 */
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { rank } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { McpCaller } from "./tokens.js";

/** Every member of `ServerPluginContext`, as of the 20-member interface. */
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
  "sendExtensionMessage",
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
 * Members reachable through the MCP surface. `onEvent` backs
 * `subscriptions/listen`, a protocol method rather than a `tools/list` entry,
 * but still an exposed capability the partition must account for.
 */
export const ALLOWLISTED_CONTEXT_MEMBERS = [
  "sessionManager",
  "sendToSession",
  "spawnSession",
  "abortSession",
  "onEvent",
] as const;

/** A context member reachable through the MCP surface. */
export type AllowlistedMember = (typeof ALLOWLISTED_CONTEXT_MEMBERS)[number];

/**
 * Members the plugin uses internally but never exposes to a caller.
 * `fastify` backs `POST /api/session/:id/lifecycle` etc. via `inject` — the tool
 * surface reaches the route, never the server instance.
 */
export const INTERNAL_ONLY_CONTEXT_MEMBERS = ["fastify"] as const;

/** Members that must never be reachable. */
export const DENIED_CONTEXT_MEMBERS = [
  "eventStore",
  "broadcastToSubscribers",
  "registerPiHandler",
  "registerBrowserHandler",
  "onSessionEnded",
  "emitEventToSession",
  "sendExtensionMessage",
  "abortSpawnedRun",
  "provide",
  "consume",
  "consumeAll",
  "getPluginConfig",
  "updatePluginConfig",
  "logger",
] as const;

/** Verbs that must never appear as tools. */
export const FORBIDDEN_VERB_NAMES = [
  // UI-only.
  "reorder_pinned_dirs",
  "set_session_process_drawer",
  // Transport plumbing.
  "subscribe",
  "watch_files",
  "worktree_init_subscribe",
] as const;

/** Minimal structural shape shared by the generated tools and test fixtures. */
export interface ToolLike {
  name: string;
  description: string;
  tier: Tier;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  inputSchema: Record<string, unknown>;
}

/**
 * Filter to the tools a caller's tier may see (D2). `rank` is shared with the
 * REST route gate, so the two surfaces agree by construction.
 */
export function filterToolsForTier<T extends ToolLike>(tools: readonly T[], tier: Tier): T[] {
  return tools.filter((t) => rank(t.tier) <= rank(tier));
}

/** The `tools/list` wire payload — never leaks the transport binding. */
export function listTools<T extends ToolLike>(tools: readonly T[], tier: Tier = "operate") {
  return filterToolsForTier(tools, tier).map((t) => ({
    name: t.name,
    description: t.description,
    annotations: t.annotations,
    inputSchema: t.inputSchema,
  }));
}

/** Look up an advertised tool by name. */
export function findTool<T extends ToolLike>(name: unknown, tools: readonly T[]): T | undefined {
  return typeof name === "string" ? tools.find((t) => t.name === name) : undefined;
}

/** A handler resolver: given a tool name, produce its invocable handler. */
export type ToolHandlerResolver = (name: string) => ((...args: never[]) => unknown) | undefined;

export interface CompletenessResult {
  ok: boolean;
  /** Advertised tools with no invocable handler. */
  missing: string[];
}

/**
 * Assert every advertised tool resolves to an invocable handler (E22).
 * Deliberately parameterised over the table and the resolver so a fixture can
 * prove the check FAILS.
 */
export function checkToolCompleteness(
  tools: readonly { name: string }[],
  resolve: ToolHandlerResolver,
): CompletenessResult {
  const missing = tools.filter((t) => typeof resolve(t.name) !== "function").map((t) => t.name);
  return { ok: missing.length === 0, missing };
}

export interface PartitionResult {
  ok: boolean;
  /** Members in no list — a new context member nobody triaged. */
  unclassified: string[];
  /** Members in more than one list — a contradiction. */
  overlapping: string[];
}

/**
 * Assert the allowlist, denylist and internal-only list account for every
 * context member, exactly once.
 */
export function assertContextPartitionTotal(
  all: readonly string[] = ALL_CONTEXT_MEMBERS,
  allowed: readonly string[] = ALLOWLISTED_CONTEXT_MEMBERS,
  denied: readonly string[] = DENIED_CONTEXT_MEMBERS,
  internal: readonly string[] = INTERNAL_ONLY_CONTEXT_MEMBERS,
): PartitionResult {
  const lists = [allowed, denied, internal];
  const unclassified = all.filter((m) => !lists.some((l) => l.includes(m)));
  const overlapping = all.filter((m) => lists.filter((l) => l.includes(m)).length > 1);
  return { ok: unclassified.length === 0 && overlapping.length === 0, unclassified, overlapping };
}

/** Re-exported for handler signatures that need the resolved caller. */
export type { McpCaller };
