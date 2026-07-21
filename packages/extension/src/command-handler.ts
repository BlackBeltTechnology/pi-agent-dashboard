/**
 * Handles server→extension messages by dispatching to pi API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { diffOr } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type {
  ExtensionToServerMessage,
  ServerToExtensionMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { FileEntry, MissingToolError, PiSessionInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { filterHiddenCommands } from "./bridge-context.js";
import { draftCommitMessage } from "./commit-draft.js";
import { killProcessByPgid } from "./process-scanner.js";
import { expandPromptTemplateFromDisk, loadPromptTemplate } from "./prompt-expander.js";
import { buildProviderCatalogue, toModelInfo } from "./provider-register.js";
import { filterByEnabledModels } from "./session-sync.js";
import { tryDispatchExtensionCommand } from "./slash-dispatch.js";

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "__pycache__", ".venv"]);
const MAX_RESULTS = 50;
/** Entries scanned budget — decoupled from the result cap so a deep first
 *  subtree no longer starves shallow sibling matches. Softened from 4000 so
 *  matches in later top-level subtrees of a large monorepo are no longer
 *  dropped at the horizon; `.gitignore` pruning keeps the real per-walk cost
 *  low despite the higher ceiling.
 *  See change: fix-file-mention-search-ranking, split-editor-workspace. */
const MAX_VISITS = 20000;
/** Depth guard, relaxed from 6 so deeply-nested source is reachable.
 *  See change: split-editor-workspace. */
const MAX_DEPTH = 12;

/**
 * Translate one `.gitignore` pattern into a matcher regex (best-effort — not
 * full gitignore semantics). Bare names match a path segment anywhere; slashed
 * patterns anchor at the root. `*`/`?` become segment-scoped globs. Negations
 * and comments are filtered before this is called. Mirrored in the server
 * content-grep JS fallback (`packages/server/src/lib/grep.ts`) — kept inline
 * rather than shared because the worktree resolves the shared package to the
 * main checkout. See change: split-editor-workspace.
 */
export function gitignoreToRegex(pattern: string): RegExp | null {
  let p = pattern.trim();
  if (!p || p.startsWith("#") || p.startsWith("!")) return null;
  const anchored = p.startsWith("/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return null;
  const esc = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  const hasSlash = p.includes("/");
  try {
    const body = anchored || hasSlash ? `^${esc}(/|$)` : `(^|/)${esc}(/|$)`;
    return new RegExp(body, "i");
  } catch {
    return null;
  }
}

/**
 * Build a `.gitignore`-backed pruning predicate for `cwd`. Best-effort: a
 * missing or unreadable `.gitignore` yields a predicate that ignores nothing.
 * The returned fn receives a slash-normalised rel-path (no trailing slash).
 * See change: split-editor-workspace.
 */
export function loadGitignoreMatcher(cwd: string): (relPath: string) => boolean {
  let regexes: RegExp[] = [];
  try {
    const raw = readFileSync(join(cwd, ".gitignore"), "utf-8");
    regexes = raw
      .split(/\r?\n/)
      .map((l) => gitignoreToRegex(l))
      .filter((r): r is RegExp => r !== null);
  } catch {
    return () => false;
  }
  return (relPath: string) => regexes.some((re) => re.test(relPath));
}

/** Score a leaf against a candidate using a precompiled regex (flat tiers). */
export function scoreRegexMatch(relPath: string, re: RegExp): number {
  const lower = relPath.toLowerCase();
  const trimmed = lower.endsWith("/") ? lower.slice(0, -1) : lower;
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (re.test(base)) return 2;
  if (re.test(trimmed)) return 1;
  return 0;
}

/**
 * Split a (lowercased) query at the LAST slash. The prefix (up to and
 * including that slash) scopes candidates; the leaf is ranked as a basename.
 * A query without a slash yields an empty prefix and the whole query as leaf.
 * See change: fix-file-mention-search-ranking.
 */
export function splitQuery(lowerQuery: string): { prefix: string; leaf: string } {
  const idx = lowerQuery.lastIndexOf("/");
  if (idx === -1) return { prefix: "", leaf: lowerQuery };
  return { prefix: lowerQuery.slice(0, idx + 1), leaf: lowerQuery.slice(idx + 1) };
}

/**
 * Score `leaf` (lowercased) against a candidate `relPath`. Tiers, highest
 * first: 4 exact basename, 3 basename prefix, 2 basename substring,
 * 1 path substring (fallback). Empty leaf → 0 (depth tie-break decides).
 * Returns 0 for a non-empty leaf absent from both basename and path → dropped.
 * See change: fix-file-mention-search-ranking.
 */
export function scoreMatch(relPath: string, leaf: string): number {
  if (leaf === "") return 0;
  const lower = relPath.toLowerCase();
  const trimmed = lower.endsWith("/") ? lower.slice(0, -1) : lower;
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (base === leaf) return 4;
  if (base.startsWith(leaf)) return 3;
  if (base.includes(leaf)) return 2;
  if (lower.includes(leaf)) return 1;
  return 0;
}

/**
 * Walk `cwd` BREADTH-FIRST up to MAX_VISITS entries (depth ≤ 6, IGNORE_DIRS
 * skipped), collect every candidate that survives the slash-aware prefix
 * filter + leaf scoring, rank them (score desc, depth asc, pathLen asc,
 * alpha asc), and return at most MAX_RESULTS — the highest-ranked, not the
 * first reached.
 *
 * BFS (level-order queue) is load-bearing: it visits shallowest entries
 * first, so when MAX_VISITS bounds a large tree the budget spends on shallow
 * matches before deep ones. A depth-first walk would drain the budget inside
 * an early subtree (e.g. a huge `openspec/changes/archive/`) and starve
 * shallow siblings like root `package.json` — the exact failure the
 * file-autocomplete anti-starvation requirement forbids.
 * See change: fix-file-mention-search-ranking.
 */
export function searchFiles(cwd: string, query: string, opts?: { regex?: boolean }): FileEntry[] {
  const lowerQuery = query?.toLowerCase() ?? "";
  const { prefix, leaf } = splitQuery(lowerQuery);

  // Optional regexp leaf: compile once, degrade to substring on an invalid
  // pattern so a half-typed regex never errors the walk. See change:
  // split-editor-workspace.
  let leafRe: RegExp | null = null;
  if (opts?.regex && leaf !== "") {
    try { leafRe = new RegExp(leaf, "i"); } catch { leafRe = null; }
  }

  const isIgnored = loadGitignoreMatcher(cwd);
  const candidates: Array<{ path: string; isDirectory: boolean; depth: number; score: number }> = [];
  let visits = 0;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0 && visits < MAX_VISITS) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (visits >= MAX_VISITS) break;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const isDirectory = entry.isDirectory();
      const relNoSlash = relative(cwd, fullPath).replace(/\\/g, "/");
      // `.gitignore` pruning: skip ignored files and do not descend ignored
      // dirs, so the visit budget is spent on real source.
      if (isIgnored(relNoSlash)) continue;
      visits++;
      const relPath = relNoSlash + (isDirectory ? "/" : "");
      const inScope = !prefix || relPath.toLowerCase().includes(prefix);
      if (inScope) {
        const score = leafRe ? scoreRegexMatch(relPath, leafRe) : scoreMatch(relPath, leaf);
        if (leaf === "" || score > 0) {
          candidates.push({ path: relPath, isDirectory, depth, score });
        }
      }
      if (isDirectory) queue.push({ dir: fullPath, depth: depth + 1 });
    }
  }

  // Empty leaf (bare `@`): every entry scores 0, so order by depth then
  // alphabetically per the bare-@ requirement (pathLen tie-break omitted).
  // Non-empty leaf: full ranking tie-break score→depth→pathLen→alpha.
  candidates.sort((a, b) =>
    b.score - a.score ||
    a.depth - b.depth ||
    (leaf === "" ? 0 : a.path.length - b.path.length) ||
    a.path.localeCompare(b.path)
  );

  return candidates.slice(0, MAX_RESULTS).map((c) => ({ path: c.path, isDirectory: c.isDirectory }));
}

/** Parsed result from parseSendPrompt */
export type ParsedPrompt =
  | { type: "bash"; command: string; excludeFromContext: boolean }
  | { type: "compact"; customInstructions: string | undefined }
  | { type: "model"; provider: string; modelId: string }
  | { type: "shutdown" }
  | { type: "reload" }
  | { type: "new" }
  | { type: "mgmt"; event: string; data: Record<string, unknown> }
  | { type: "slash"; text: string }
  | { type: "passthrough"; text: string };

/** pi-flows management commands with known event mappings.
 *  These are dispatched via pi.events instead of flow:run.
 *  Flow management commands (flows:new, flows:edit, flows:delete) are
 *  handled in bridge.ts sessionPrompt callback which passes cachedCtx
 *  as fallback context for headless sessions. */
const MANAGEMENT_COMMAND_EVENTS: Record<string, {
  event: string;
  dataFn: (args: string) => Record<string, unknown>;
}> = {};

/** Parse input text to detect pi internal command prefixes */
export function parseSendPrompt(text: string): ParsedPrompt {
  // 1. Check !! (must check before !)
  if (text.startsWith("!!")) {
    const command = text.slice(2).trim();
    if (!command) return { type: "passthrough", text };
    return { type: "bash", command, excludeFromContext: true };
  }

  // 2. Check !
  if (text.startsWith("!")) {
    const command = text.slice(1).trim();
    if (!command) return { type: "passthrough", text };
    return { type: "bash", command, excludeFromContext: false };
  }

  // 3. Check /compact
  if (text === "/compact" || text.startsWith("/compact ")) {
    const args = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
    return { type: "compact", customInstructions: args || undefined };
  }

  // 4. Check /quit and /exit
  if (text === "/quit" || text === "/exit") {
    return { type: "shutdown" };
  }

  // 4b. Check /reload
  if (text === "/reload") {
    return { type: "reload" };
  }

  // 4c. Check /new
  if (text === "/new") {
    return { type: "new" };
  }

  // 4d. Check /model <provider/id>
  if (text.startsWith("/model ")) {
    const modelStr = text.slice(7).trim();
    const slashIdx = modelStr.indexOf("/");
    if (slashIdx > 0) {
      return { type: "model", provider: modelStr.slice(0, slashIdx), modelId: modelStr.slice(slashIdx + 1) };
    }
  }

  // 5. Check management commands (/flows:new, etc.) with known event mappings
  if (text.startsWith("/") && !text.includes("\n")) {
    const cmdText = text.slice(1);
    const spaceIdx = cmdText.indexOf(" ");
    const cmdName = spaceIdx === -1 ? cmdText : cmdText.slice(0, spaceIdx);
    const cmdArgs = spaceIdx === -1 ? "" : cmdText.slice(spaceIdx + 1);
    const mgmt = MANAGEMENT_COMMAND_EVENTS[cmdName];
    if (mgmt) {
      return { type: "mgmt", event: mgmt.event, data: mgmt.dataFn(cmdArgs) };
    }
  }

  // 6. Check / prefix (generic slash command)
  if (text.startsWith("/") && !text.includes("\n")) {
    return { type: "slash", text };
  }

  // 5. Passthrough
  return { type: "passthrough", text };
}

const BASH_TIMEOUT = 30_000;

export interface CommandHandler {
  handle(msg: ServerToExtensionMessage): ExtensionToServerMessage | undefined | Promise<ExtensionToServerMessage | undefined>;
}

export function createCommandHandler(
  pi: ExtensionAPI,
  sessionIdOrGetter: string | (() => string),
  options?: {
    getModelRegistry?: () => any;
    /**
     * Ephemeral fork-subagent driver for AI-drafted commit messages: run one
     * throwaway in-memory agent turn on `seed` and resolve with the assistant
     * text. Wired from bridge.ts (has model/registry/authStorage). Absent →
     * the draft ladder falls to the deterministic stub. Never appends to the
     * visible conversation. See change: add-session-uncommitted-indicator-and-commit.
     */
    runDraftAgent?: (seed: string, cwd: string) => Promise<string>;
    /** Compact text of the live session context for the draft seed. */
    getSessionContextText?: () => string | undefined;
    setThinkingLevel?: (level: string) => void;
    getThinkingLevel?: () => string | undefined;
    shutdown?: () => void;
    /**
     * Full bridge wrapper-abort. Runs the queue clears, shadow reset,
     * `cachedCtx.abort()`, and `retryTracker.noteAbort`. Invoked exactly
     * once on the initial user-abort command. Subsequent persistent-abort
     * scheduler ticks invoke `rawAbort` instead to avoid re-running the
     * wrapper's side-effects on every tick.
     * See change: unify-status-banner-and-terminal-limit-stop.
     */
    abort?: () => void;
    /**
     * Raw `cachedCtx.abort()` only. Used by the persistent-abort scheduler
     * after the initial wrapper-abort has run, so repeated ticks do not
     * re-clear pi queues or reset bridge shadows. Closes the spec/impl
     * drift where the scheduler previously re-ran the full wrapper.
     * See change: unify-status-banner-and-terminal-limit-stop.
     */
    rawAbort?: () => void;
    /**
     * Probe agent idleness for the persistent-abort scheduler.
     * See change: fix-provider-retry-infinite-loop.
     */
    isIdle?: () => boolean;
    getCwd?: () => string;
    /** Callback to send events (e.g., bash_output, command_feedback) back to server */
    eventSink?: (msg: ExtensionToServerMessage) => void;
    /** Trigger context compaction */
    compact?: (options: { customInstructions?: string }) => void;
    /** Trigger session reload (extensions, settings, skills, etc.) */
    reload?: () => void;
    /** Spawn a new session in the same cwd */
    spawnNew?: () => void;
    /** Switch model via pi.setModel() */
    setModel?: (provider: string, modelId: string) => Promise<void>;
    /**
     * Route slash commands through pi's command system. May be sync or async.
     * In bridge wiring this also runs the extension-command dispatch branch
     * (see slash-dispatch.ts). The handler awaits the result so command_feedback
     * events emitted by the dispatch path arrive before this turn returns.
     * See change: fix-extension-slash-commands-in-dashboard.
     */
    sessionPrompt?: (text: string, delivery?: "steer" | "followUp") => void | Promise<void>;
    /**
     * Bridge-shadow-queue hooks: called AFTER pi accepts the user message,
     * gated by `isStreaming()` captured BEFORE the send. The capture order
     * matters — `pi.sendUserMessage` on an idle session synchronously
     * triggers `agent_start`, which flips bridge state to streaming. Checking
     * AFTER the send would mis-record idle sends as chip entries.
     * Pi doesn't expose `queue_update` to extensions, so the bridge is the
     * source of truth. See change: add-followup-edit-and-steer-cancel.
     */
    onSteerSent?: (text: string) => void;
    onFollowupSent?: (text: string) => void;
    /**
     * Returns true iff the agent was streaming at the moment of the call.
     * Used to capture pre-send streaming state before `pi.sendUserMessage`
     * runs (which may flip the flag synchronously via agent_start).
     * See change: add-followup-edit-and-steer-cancel.
     */
    isStreaming?: () => boolean;
    /**
     * Mirror a server `attach_proposal_changed` push into the bridge's
     * `BridgeContext.attachedChange`. The `before_agent_start` injector reads
     * that field to build the per-turn system-prompt fragment. Foreign-session
     * messages are already dropped by the sessionId guard at the top of
     * `handle`. See change: inject-session-context-into-agent.
     */
    onAttachProposalChanged?: (attachedChange: string | null) => void;
    /**
     * Clear the bridge's abort latch. Called at the start of `send_prompt`
     * (before pi.sendUserMessage) so a deliberate new turn is never aborted
     * by a latch left set from a prior user abort. See change:
     * unify-error-retry-lifecycle.
     */
    noteUserPrompt?: () => void;
  },
): CommandHandler {
  const getSessionId = typeof sessionIdOrGetter === "function" ? sessionIdOrGetter : () => sessionIdOrGetter;

  /**
   * Persistent-abort scheduler. Re-invokes `options.rawAbort()` (NOT the
   * full wrapper-abort) at 200ms intervals for up to 2 seconds, breaking
   * early when (a) `opts.isStreaming()` transitions from true at scheduler
   * start to false (i.e. agent_end for the aborted turn has flipped the
   * bridge state), OR (b) `opts.isIdle()` returns true, OR (c) 2s elapsed.
   *
   * Closes the retry race window in pi-coding-agent (`_retryAbortController`
   * is briefly `undefined` between sleep-end and the next `agent.continue()`
   * call) without clobbering user prompts sent within the 2s window.
   *
   * See change: fix-provider-retry-infinite-loop (original scheduler).
   * See change: unify-status-banner-and-terminal-limit-stop (rawAbort +
   * streaming-transition break).
   */
  const PERSISTENT_ABORT_INTERVAL_MS = 200;
  const PERSISTENT_ABORT_MAX_MS = 2000;
  function schedulePersistentAbort(opts: NonNullable<typeof options>): void {
    if (!opts.rawAbort) return;
    const startedAt = Date.now();
    const wasStreamingAtStart = opts.isStreaming?.() === true;
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= PERSISTENT_ABORT_MAX_MS) {
        clearInterval(interval);
        return;
      }
      // Break on the agent settling: once streaming flips back to false
      // (agent_end for the aborted turn processed), persistent-abort has
      // nothing left to do, and continuing would risk killing any new
      // turn the user re-started within the window.
      if (wasStreamingAtStart && opts.isStreaming?.() === false) {
        clearInterval(interval);
        return;
      }
      try {
        if (opts.isIdle?.()) {
          clearInterval(interval);
          return;
        }
      } catch { /* probe failure — keep trying */ }
      try { opts.rawAbort?.(); } catch { /* idempotent */ }
    }, PERSISTENT_ABORT_INTERVAL_MS);
  }

  return {
    async handle(msg: ServerToExtensionMessage): Promise<ExtensionToServerMessage | undefined> {
      const sessionId = getSessionId();

      // Ignore messages for other sessions (skip session-less messages like heartbeat_ack)
      if ((msg as any).sessionId !== undefined && (msg as any).sessionId !== sessionId) {
        console.error(`[dashboard] Ignoring message type=${msg.type} for session ${(msg as any).sessionId}, current session is ${sessionId}`);
        return undefined;
      }

      switch (msg.type) {
        case "send_prompt": {
          const parsed = parseSendPrompt(msg.text);

          // Non-turn commands (bash/compact/shutdown/reload/new/model/mgmt)
          // return early below and never produce a user `message_start`, so an
          // optimistic idle `pendingPrompt` bubble would hang until the 30s
          // safety timeout. Settle it immediately (fresh:false → drop). The
          // passthrough + slash paths emit their own `prompt_received` with the
          // real streaming verdict. See change: optimistic-prompt-progress.
          if (parsed.type !== "passthrough" && parsed.type !== "slash") {
            options?.eventSink?.({ type: "prompt_received", sessionId, fresh: false });
          }

          // Route based on parsed command type
          if (parsed.type === "bash") {
            await handleBashCommand(pi, sessionId, parsed.command, parsed.excludeFromContext, options?.eventSink);
            return undefined;
          }

          if (parsed.type === "compact") {
            await handleCompactCommand(sessionId, parsed.customInstructions, options?.compact, options?.eventSink);
            return undefined;
          }

          if (parsed.type === "shutdown") {
            if (options?.shutdown) {
              options.shutdown();
            }
            return undefined;
          }

          if (parsed.type === "reload") {
            if (options?.reload) {
              options.reload();
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: "/reload", status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "new") {
            if (options?.spawnNew) {
              options.spawnNew();
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: "/new", status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "model") {
            if (options?.setModel) {
              await options.setModel(parsed.provider, parsed.modelId);
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: `/model ${parsed.provider}/${parsed.modelId}`, status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "mgmt") {
            // Dispatch management command via pi.events (e.g. flows:new-request)
            if ((pi as any).events) {
              (pi as any).events.emit(parsed.event, parsed.data);
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: parsed.event, status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "slash") {
            if (options?.sessionPrompt) {
              // sessionPrompt (bridge) owns slash-dispatch + flow fast-path +
              // template expansion. It also owns command_feedback emission for
              // extension-command dispatch. Do NOT emit completed here — would
              // duplicate the dispatch path's terminal event.
              // See change: fix-extension-slash-commands-in-dashboard.
              await options.sessionPrompt(parsed.text, msg.delivery);
            } else {
              // Test / non-bridge callers: apply the extension-command dispatch
              // branch inline before falling through to sendUserMessage. Keeps
              // both call sites in lockstep per spec routing-step 9.
              const handled = await tryDispatchExtensionCommand(
                pi,
                parsed.text,
                sessionId,
                options?.eventSink,
                undefined, // connection — absent in non-bridge path
                msg.delivery,
              );
              // Exec-mode slash template (executable: bash): run as bash, no LLM.
              // Runs AFTER extension dispatch, BEFORE the sendUserMessage
              // fallback (disjoint by construction — see spec routing
              // precedence). See change: add-dashboard-slash-commands.
              const ranExec =
                !handled &&
                (await tryExecSlashTemplate(pi, parsed.text, process.cwd(), sessionId, options?.eventSink));
              if (!handled && !ranExec) {
                // sendUserMessage exempt from gating: only typed single-line
                // slashes that are NOT extension commands reach this — i.e.
                // skills, prompt templates, unrecognized slashes.
                // Forward delivery so steering on slash fallback honors the
                // dashboard's keyboard contract. See change: add-steering-message.
                const deliverAs = msg.delivery ?? ("followUp" as const);
                (pi.sendUserMessage as any)(parsed.text, { deliverAs });
              }
            }
            return undefined;
          }

          // Passthrough: send as regular user message (with image handling).
          // Multi-line slash commands (e.g. "/skill:foo\nuser text") are classified as
          // passthrough by parseSendPrompt to preserve images (the slash route strips them),
          // so we expand prompt templates / skills here before sending.
          //
          // sendUserMessage exempt from extension-dispatch gating: this path handles
          // multi-line slashes and image-bearing messages. Per spec, only typed
          // single-line slash text gates through extension dispatch — multi-line and
          // image-bearing messages go raw to the LLM as before.
          // See change: fix-extension-slash-commands-in-dashboard.
          // A real user turn WILL be dispatched on this passthrough path — clear
          // any latched abort BEFORE pi.sendUserMessage (which can fire
          // agent_start synchronously) so the new turn is never aborted by the
          // latch. Placed here (not at the top of send_prompt) so non-turn
          // commands (bash, compact, model, mgmt, slash dispatch/exec) do NOT
          // disarm the latch — they never start a replacement turn.
          // See change: unify-error-retry-lifecycle.
          options?.noteUserPrompt?.();
          let outgoing = msg.text;
          if (outgoing.startsWith("/")) {
            outgoing = expandPromptTemplateFromDisk(outgoing, process.cwd(), pi);
          }
          // Route the prompt based on delivery + streaming state:
          //
          //   delivery="followUp" + streaming → ONLY notify bridge buffer
          //                                      (pi never sees it until
          //                                      drainFollowupQueue ships it
          //                                      on agent_end as a fresh turn).
          //   delivery="steer"    + streaming → forward to pi + shadow-record.
          //   any delivery        + idle      → forward to pi (fresh turn).
          //
          // Capture pre-send streaming state BEFORE any pi call — pi flips
          // idle→streaming synchronously on the first user message, so
          // checking after sendUserMessage gives false positives.
          //
          // Image attachments are NOT carried in the bridge buffer in v1
          // (text-only). Image-bearing follow-ups buffered during streaming
          // will lose their images on drain (Known Limitation).
          //
          // See change: rework-mid-turn-prompt-queue (design.md D1).
          const wasStreaming = options?.isStreaming?.() ?? false;
          // Per-send ack carrying the capture-before-send streaming verdict.
          // Drives the optimistic `pendingPrompt` bubble: fresh:true → "sent",
          // fresh:false → drop (raced mid-turn). Emitted BEFORE any pi call so
          // the snapshot is authoritative. See change: optimistic-prompt-progress.
          options?.eventSink?.({ type: "prompt_received", sessionId, fresh: !wasStreaming });
          const da = msg.delivery ?? "followUp";
          if (wasStreaming && da === "followUp") {
            // Bridge-owned buffer path — do NOT call pi.sendUserMessage.
            options?.onFollowupSent?.(outgoing);
          } else {
            // Idle or steer — forward to pi directly.
            sendUserMessageWithImages(pi, outgoing, msg.images, msg.delivery);
            if (wasStreaming && da === "steer") options?.onSteerSent?.(outgoing);
          }
          return undefined;
        }

        case "abort":
          // Pi owns both queues now. abort() asks pi to halt the current turn;
          // pi's native drain logic handles any remaining queue entries naturally.
          // See change: add-followup-edit-and-steer-cancel.
          if (options?.abort) {
            options.abort();
          }
          // Synthesize an immediate auto_retry_end so the dashboard clears
          // any in-flight retry banner without waiting for pi's natural
          // auto_retry_end (which is delayed by the abortable-sleep cancel
          // window AND, on extension API, never reaches us at all — see
          // https://github.com/badlogic/pi-mono/discussions/2073). The
          // reducer no-ops auto_retry_end when retryState is undefined,
          // so this is idempotent against later events.
          //
          // No `finalError` is supplied: the placeholder "Aborted by user"
          // previously overwrote SessionState.lastError, hiding the real
          // provider error (e.g. usage_limit_reached). The orderer's pending
          // flag now survives wrapper-abort, so pi's terminal agent_end can
          // still synthesize a proper finalError carrying the real message.
          // See change: unify-status-banner-and-terminal-limit-stop.
          if (options?.eventSink) {
            options.eventSink({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "auto_retry_end",
                timestamp: Date.now(),
                data: { success: false, attempt: -1 },
              },
            });
          }
          // Persistent-abort scheduler: pi-coding-agent's _retryAbortController
          // is briefly `undefined` between sleep-end and the next
          // agent.continue() call. An abort that arrives in that window is
          // a no-op against the retry. Re-invoke abort every 200ms for up
          // to 2s, breaking early when the agent is idle.
          // See change: fix-provider-retry-infinite-loop.
          if (options) schedulePersistentAbort(options);
          return undefined;

        case "request_commands": {
          const commands = filterHiddenCommands(pi.getCommands());
          // Also send flows list alongside commands
          if (options?.eventSink) {
            const probe: any = {};
            try { pi.events?.emit("flow:list-flows", probe); } catch { /* ignore */ }
            options.eventSink({ type: "flows_list", sessionId, flows: probe.flows ?? [] });
          }
          return {
            type: "commands_list",
            sessionId,
            commands,
          };
        }

        case "list_files": {
          // `regex` is optional (editor filename search); absent for `@`-mention.
          const files = searchFiles(process.cwd(), msg.query, { regex: msg.regex });
          return {
            type: "files_list",
            sessionId,
            query: msg.query,
            files,
          };
        }

        case "git_commit_draft": {
          // AI-draft a commit message from the session's own context + the
          // staged diff, via an ephemeral fork-subagent. Never touches the
          // visible conversation. Always resolves (worst case: stub).
          // See change: add-session-uncommitted-indicator-and-commit.
          const draftMsg = msg as {
            requestId: string; cwd: string; files: string[];
          };
          const cwd = draftMsg.cwd || options?.getCwd?.() || process.cwd();
          // Guard against a malformed payload: `files` must be an array of
          // strings before we map over it. Coerce to a safe empty list so the
          // draft ladder falls to its deterministic stub rather than throwing.
          const draftFiles = Array.isArray(draftMsg.files)
            ? draftMsg.files.filter((f): f is string => typeof f === "string")
            : [];
          const result = await draftCommitMessage({
            files: draftFiles,
            buildDiff: () =>
              draftFiles.map((f) => diffOr({ cwd, path: f })).join("\n"),
            buildContext: () => options?.getSessionContextText?.(),
            runAgent: options?.runDraftAgent
              ? (seed) => options.runDraftAgent!(seed, cwd)
              : undefined,
          });
          return {
            type: "git_commit_draft_result",
            sessionId,
            requestId: draftMsg.requestId,
            message: result.message,
            source: result.source,
          };
        }

        // openspec_refresh removed — server handles directly via DirectoryService

        case "attach_proposal_changed":
          // The top-of-handle guard only drops MISMATCHED sessionIds; a payload
          // with no sessionId falls through. Require an exact match so an
          // unscoped message cannot mutate the active bridge's attached change.
          if (msg.sessionId !== sessionId) {
            console.error("[dashboard] Ignoring attach_proposal_changed: missing/mismatched sessionId");
            return undefined;
          }
          // Validate the socket payload shape before mirroring into
          // BridgeContext.attachedChange. See change: inject-session-context-into-agent.
          if (msg.attachedChange !== null && typeof msg.attachedChange !== "string") {
            console.error("[dashboard] Ignoring attach_proposal_changed: attachedChange must be string|null");
            return undefined;
          }
          options?.onAttachProposalChanged?.(msg.attachedChange);
          return undefined;

        case "rename_session":
          pi.setSessionName(msg.name);
          return {
            type: "session_name_update",
            sessionId,
            name: msg.name,
          };

        case "request_models": {
          const registry = options?.getModelRegistry?.();
          if (registry) {
            try {
              registry.authStorage?.reload?.();
              registry.refresh();
              const models = filterByEnabledModels(registry.getAvailable().map(toModelInfo));
              return { type: "models_list", sessionId, models };
            } catch { /* ignore */ }
          }
          return { type: "models_list", sessionId, models: [] };
        }

        case "request_providers": {
          // See change: replace-hardcoded-provider-lists.
          return { type: "providers_list", sessionId, providers: buildProviderCatalogue() };
        }

        case "set_thinking_level":
          if (options?.setThinkingLevel) {
            options.setThinkingLevel(msg.level);
          }
          return undefined;

        case "set_model":
          if (options?.setModel) {
            await options.setModel(msg.provider, msg.modelId);
          }
          return undefined;

        case "kill_process": {
          const pgid = (msg as { pgid: number }).pgid;
          if (pgid) {
            const killed = killProcessByPgid(pgid);
            console.error(`[dashboard] kill_process pgid=${pgid} result=${killed}`);
          }
          return undefined;
        }

        case "shutdown":
          if (options?.shutdown) {
            options.shutdown();
          }
          return undefined;

        case "request_state_sync":
          // State sync is handled by the bridge on reconnect
          return undefined;

        case "request_flows_refresh": {
          // Re-query pi-flows and send updated list
          if (options?.eventSink) {
            const probe: any = {};
            try { pi.events?.emit("flow:list-flows", probe); } catch { /* ignore */ }
            options.eventSink({ type: "flows_list", sessionId, flows: probe.flows ?? [] });
          }
          return undefined;
        }

        case "list_sessions": {
          try {
            // Dynamic import to avoid hard dependency at module load
            const { SessionManager } = await import("@earendil-works/pi-coding-agent") as any;
            const cwd = msg.cwd || options?.getCwd?.() || process.cwd();
            const sessionInfos = await SessionManager.list(cwd);
            const sessions: PiSessionInfo[] = (sessionInfos || []).map((s: any) => ({
              id: s.id,
              path: s.path,
              cwd: s.cwd,
              name: s.name,
              parentSessionPath: s.parentSessionPath,
              created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
              modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
              messageCount: s.messageCount ?? 0,
              firstMessage: s.firstMessage,
            }));
            return { type: "sessions_list", sessionId, cwd, sessions };
          } catch {
            return { type: "sessions_list", sessionId, cwd: msg.cwd || process.cwd(), sessions: [] };
          }
        }

        default:
          return undefined;
      }
    },
  };
}

/** Send a user message with optional image validation.
 * Uses deliverAs: "followUp" by default so messages queue properly when the agent is streaming.
 * Pass deliverAs: "steer" for steering messages (delivered after current turn).
 * See change: add-steering-message. */
function sendUserMessageWithImages(
  pi: ExtensionAPI,
  text: string,
  images?: Array<{ type: string; data: string; mimeType: string }>,
  delivery?: "steer" | "followUp",
): void {
  const deliverAs = delivery ?? ("followUp" as const);
  const sendOptions = { deliverAs };
  // POST-rework-mid-turn-prompt-queue: this helper is called for STEER and
  // for IDLE sends only — followUp-while-streaming is intercepted upstream
  // (bridge buffer path; never calls this helper). The deliverAs parameter
  // is preserved for steer routing.
  // See change: rework-mid-turn-prompt-queue (design.md D1).
  if (images && images.length > 0) {
    const validMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const validImages = images.filter((img) => {
      if (!img || typeof img !== "object") {
        console.error("[dashboard] Dropping non-object image entry");
        return false;
      }
      if (!img.mimeType || typeof img.mimeType !== "string" || !validMimeTypes.has(img.mimeType)) {
        console.error(`[dashboard] Dropping image with invalid mimeType: "${img.mimeType}" (type: ${typeof img.mimeType})`);
        return false;
      }
      if (!img.data || typeof img.data !== "string") {
        console.error(`[dashboard] Dropping image with invalid data (type: ${typeof img.data}, length: ${img.data?.length ?? 0})`);
        return false;
      }
      return true;
    });
    if (validImages.length > 0) {
      const content = [
        { type: "text" as const, text },
        ...validImages.map((img) => ({
          type: "image" as const,
          data: img.data,
          mimeType: img.mimeType,
        })),
      ];
      console.error(`[dashboard] Sending message with ${validImages.length} image(s), mimeTypes: ${validImages.map(i => i.mimeType).join(", ")}`);
      (pi.sendUserMessage as any)(content, sendOptions);
    } else {
      (pi.sendUserMessage as any)(text, sendOptions);
    }
  } else {
    (pi.sendUserMessage as any)(text, sendOptions);
  }
}

/**
 * Resolve the dashboard HTTP port, in precedence order:
 *   1. `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` env — set by the dashboard server
 *      and inherited by spawned sessions (the only reliable source when the
 *      server runs on a non-default port, e.g. the Docker test harness, whose
 *      `config.json` carries no `port` field).
 *   2. `~/.pi/dashboard/config.json` `port` — normal local installs write it.
 *   3. 8000 (default).
 * Note: `PI_DASHBOARD_URL` is the gateway (ws) port, NOT the HTTP port, so it is
 * deliberately not consulted here. See change: add-dashboard-slash-commands.
 */
function resolveDashboardPort(): number {
  for (const v of [process.env.PI_DASHBOARD_PORT, process.env.DASHBOARD_PORT]) {
    const n = Number(v);
    if (v && Number.isFinite(n) && n > 0) return n;
  }
  try {
    const raw = readFileSync(join(homedir(), ".pi", "dashboard", "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.port === "number" && Number.isFinite(parsed.port)) return parsed.port;
  } catch { /* missing / unparseable config */ }
  return 8000;
}

/**
 * Build the env vars exec-mode slash templates rely on: `PI_DASHBOARD_PORT` and
 * `PI_DASHBOARD_BASE`. See change: add-dashboard-slash-commands.
 */
export function buildDashboardExecEnv(): Record<string, string> {
  const port = resolveDashboardPort();
  return {
    PI_DASHBOARD_PORT: String(port),
    PI_DASHBOARD_BASE: `http://localhost:${port}`,
  };
}

/**
 * Resolve a typed slash command to a prompt template and, when it carries
 * `executable: bash` frontmatter, run the body as bash (no LLM) via
 * `handleBashCommand` and return true. Returns false when the text is not an
 * exec-mode template so the caller falls through to its existing path
 * (extension dispatch already ran; LLM expansion + sendUserMessage is next).
 *
 * Mirrors `tryDispatchExtensionCommand`'s shape so both call sites
 * (bridge.ts::sessionPrompt and command-handler's non-bridge slash fallback)
 * stay in lockstep. See change: add-dashboard-slash-commands.
 */
export async function tryExecSlashTemplate(
  pi: ExtensionAPI,
  text: string,
  cwd: string,
  sessionId: string,
  eventSink?: (msg: ExtensionToServerMessage) => void,
): Promise<boolean> {
  const loaded = loadPromptTemplate(text, cwd, pi as any);
  if (!loaded || loaded.kind !== "exec") return false;
  // Positional args bind as $1, $2, … inside the body (split on whitespace,
  // empty tokens dropped). Quoted args are not honoured in v1 — every exec
  // template takes simple identifiers (see design.md "Quoting hazard").
  const args = loaded.argsString.trim().split(/\s+/).filter(Boolean);
  await handleBashCommand(pi, sessionId, loaded.body, loaded.excludeFromContext, eventSink, {
    args,
    env: buildDashboardExecEnv(),
    source: "slash-exec",
  });
  return true;
}

/** Options for executable-mode bash invocation (slash-exec templates). */
interface BashExecOptions {
  /** Positional args passed after `--` so `$1`, `$2`, … bind in the body. */
  args?: string[];
  /** Env vars injected by prepending `export` statements to the body. */
  env?: Record<string, string>;
  /** Marks the emitted bash_output event so the client renders the footer. */
  source?: "slash-exec";
}

/** Execute a bash command and forward results */
async function handleBashCommand(
  pi: ExtensionAPI,
  sessionId: string,
  command: string,
  excludeFromContext: boolean,
  eventSink?: (msg: ExtensionToServerMessage) => void,
  execOpts?: BashExecOptions,
): Promise<void> {
  // Resolve the shell binary through the tool registry instead of
  // spawning the literal "sh". On a clean Windows host (no Git-for-Windows
  // / WSL bash on PATH) resolution fails; we emit a structured
  // MissingToolError the client renders as an actionable inline error
  // with a deep-link to Settings → Tools — never a bare ENOENT.
  // See change: register-bash-and-tool-install-help.
  const resolved = getDefaultRegistry().resolve("bash");
  if (!resolved.ok || !resolved.path) {
    const missingTool: MissingToolError = { kind: "missing-tool", toolName: "bash" };
    eventSink?.({
      type: "event_forward",
      sessionId,
      event: {
        eventType: "bash_output",
        timestamp: Date.now(),
        data: {
          command,
          output: "bash not found — install it from Settings → Tools.",
          exitCode: 127,
          excludeFromContext,
          missingTool,
        },
      },
    });
    // Do NOT spawn and do NOT send to the LLM — the command never ran.
    return;
  }

  // Inject dashboard env by prepending `export` statements to the body
  // (pi.exec's ExecOptions has no `env` field). Values are a port number and
  // a localhost URL — shell-safe — but single-quote-escape defensively.
  let script = command;
  if (execOpts?.env) {
    const exports = Object.entries(execOpts.env)
      .map(([k, v]) => `export ${k}='${String(v).replace(/'/g, "'\\''")}'`)
      .join("; ");
    if (exports) script = `${exports}\n${command}`;
  }
  // Positional args bind as $1, $2, … via `bash -c <script> -- arg1 arg2`
  // ($0 becomes `--`). Absent for `!` / `!!` — those pass no extra argv.
  const argv = execOpts?.args?.length
    ? ["-c", script, "--", ...execOpts.args]
    : ["-c", script];

  let output = "";
  let exitCode = 0;
  try {
    // Spawn the resolved absolute path directly (no shell, no PATH dep).
    const result = await pi.exec(resolved.path, argv, { timeout: BASH_TIMEOUT });
    output = (result.stdout || "") + (result.stderr || "");
    exitCode = result.exitCode ?? 0;
  } catch (err: any) {
    output = err?.message ?? "Command execution failed";
    exitCode = 1;
  }

  // Forward bash output event. `source` is set only for slash-exec templates
  // so the client renders the "ran locally" footer; absent for ! / !!.
  eventSink?.({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "bash_output",
      timestamp: Date.now(),
      data: execOpts?.source
        ? { command, output, exitCode, excludeFromContext, source: execOpts.source }
        : { command, output, exitCode, excludeFromContext },
    },
  });

  // For ! (not !!), also send to LLM
  if (!excludeFromContext) {
    const message = `$ ${command}\n${output}`;
    pi.sendUserMessage(message);
  }
}

/** Handle /compact command */
async function handleCompactCommand(
  sessionId: string,
  customInstructions: string | undefined,
  compact?: (options: { customInstructions?: string }) => void,
  eventSink?: (msg: ExtensionToServerMessage) => void,
): Promise<void> {
  eventSink?.({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: { command: "/compact", status: "started" },
    },
  });

  try {
    if (compact) {
      compact({ customInstructions });
    }
  } catch (err: any) {
    eventSink?.({
      type: "event_forward",
      sessionId,
      event: {
        eventType: "command_feedback",
        timestamp: Date.now(),
        data: { command: "/compact", status: "error", message: err?.message ?? "Compaction failed" },
      },
    });
  }
}

// handleLoadSessionEvents removed — server loads sessions directly via DirectoryService
