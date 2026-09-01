/**
 * pi-dashboard-kb extension entry point.
 *
 * Phase 2 (design §8.2): registers `kb_search` / `kb_neighbors` / `kb_get`
 * native tools and a single `tool_result` hook with two jobs:
 *   Job 1 (always on): a write/edit to a `.md` file → debounced, hash-gated
 *     incremental reindex. Editing an AGENTS.md also acknowledges its rows.
 *   Job 2 (opt-in, `doxEnforcement` default OFF): a write/edit to a non-md
 *     source file → one bounded, deduped nudge to update the nearest AGENTS.md
 *     row (or to run `kb dox init` on a treeless path).
 *
 * Isolated standalone extension — NOT in `src/extension/bridge.ts` (design §6d,
 * R §5.2). Retrieval is pull: the agent calls the tools; nothing is auto-injected
 * except the opt-in DOX nudge.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Minimal structural shape of the extension context we use (cwd). */
type Ctx = { cwd?: string };

import { readFileSync } from "node:fs";
import { agentsChain, enrichHits, loadConfig, renderHits, searchOptsFromConfig } from "@blackbelt-technology/pi-dashboard-kb";
import { Type } from "typebox";
import { createGuard, type GuardInput, guardNoteSafe, type KbGuard, resolveGuardMode } from "./guard.js";
import {acknowledgeRows,closeKb, 
  createReindexState, 
  decideNudge, ensurePopulated, getKb, nudgeText, type ReindexState,reindexNow, scheduleReindex, 
} from "./reindex.js";

const WRITE_TOOLS = new Set(["write", "edit", "bash"]);
const AGENTS_NAMES = new Set(["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"]);

function isMd(p: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(p);
}
function isAgents(p: string): boolean {
  return AGENTS_NAMES.has(p.split("/").pop() ?? "");
}

export default function kbExtension(pi: ExtensionAPI): void {
  const state: ReindexState = createReindexState();
  let doxEnforcement = false;
  let dirAgentsPush = false;
  let guard: KbGuard | null = null;
  try {
    const cfg = loadConfig(process.cwd());
    doxEnforcement = cfg.doxEnforcement;
    dirAgentsPush = cfg.directoryLevelAgents.enabled && cfg.directoryLevelAgents.mode === "push";
    // Search guard (arm B): shipped default warn (resolved at planning); config
    // selects off|warn|block, KB_GUARD_MODE may weaken to off|warn only (D14).
    guard = createGuard({ mode: resolveGuardMode(cfg.readDiscipline?.guard?.mode, process.env.KB_GUARD_MODE) });
  } catch { /* no config → guard still gets its validated default */ }
  guard ??= createGuard({ mode: resolveGuardMode(undefined, process.env.KB_GUARD_MODE) });
  if (process.env.KB_DOX_ENFORCEMENT === "1") doxEnforcement = true;
  // Warnings from tool_call ride to tool_result keyed by call id (5.3):
  // tool_call can only block, so advisory firings are stashed and prepended to
  // the result the agent actually sees.
  const pendingGuardWarnings = new Map<string, string>();
  // Bound the map: an aborted warned call never sees its tool_result, so its
  // entry would otherwise live forever. Evict oldest beyond the cap.
  const rememberGuardWarning = (id: string, text: string) => {
    if (pendingGuardWarnings.size >= 32) {
      const oldest = pendingGuardWarnings.keys().next().value;
      if (oldest !== undefined) pendingGuardWarnings.delete(oldest);
    }
    pendingGuardWarnings.set(id, text);
  };

  // --- native tools (pull retrieval) ---

  pi.registerTool({
    name: "kb_search",
    label: "KB Search",
    description:
      "Search the local markdown knowledge base (FTS5 + BM25) for ranked sections before answering from memory. " +
      "Default output is condensed text, one block per hit: `<rank>  <path>  ::  <leafHeading>`, an optional `(+N dup)` " +
      "duplicate-copy marker, an optional `(+N more sections)` marker counting further matching sections of that SAME file, " +
      "an optional `⤷ <parentHeading>` continuation, an optional trust verdict `LABEL (n of m subjects checked)`, an optional record-type mark `[agents]` / `[source-md]` (topic prose is unmarked), then a one-line snippet. " +
      "FTS match markers `[ ]` in the snippet flag the terms that matched. `rank` is a 1-based ordinal over the returned hits " +
      "(not a global score). `limit` bounds DISTINCT SOURCES (files), not chunks — one entry per file, so a page of 10 names 10 different files. " +
      "Expand a file marked `(+N more sections)` with `kb_get(path)` / `kb_get(path, section)`. " +
      "The verdict (FRESH/STALE/MOVED/GONE/UNVERIFIED) says whether the source files a DOX row documents are still accurate on disk. " +
      "It is a TRUST label only — it never affects ranking; act on STALE/GONE hits only after verifying against source. " +
      "Pass `format:\"json\"` for compact machine-readable JSON that also retains the raw BM25 `score` and the full `headingPath`.",
    promptSnippet: "Search the local markdown KB for ranked sections",
    promptGuidelines: [
      "Call kb_search FIRST for any project-specific factual / 'where is X' / 'how does Y work' question — before ctx_search, memory_search, grep, or reading source.",
      "kb_search indexes repo markdown (docs/, openspec/, packages/, .pi/). ctx_search/memory_search index session memory, not docs — different corpus. Fall through to grep/source only when kb_search returns nothing relevant.",
      "Pick the doc_type lane per query: looking for a FILE or a SYMBOL → pass doc_type:\"agents\" (the per-file record lane); asking how something WORKS, or anything conceptual → leave doc_type unset. The filter is measurably harmful on conceptual queries, so it is a lane choice, never a default.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Keyword / identifier / error-string terms to search" }),
      limit: Type.Optional(Type.Number({ default: 10 })),
      // Conditional, NOT a global win: the lane trade-off is measured in both
      // directions, so the description must name both arms and recommend
      // neither unconditionally. See change: fix-kb-search-lane-composition.
      doc_type: Type.Optional(
        Type.Union([Type.Literal("doc"), Type.Literal("agents"), Type.Literal("source-md")], {
          description:
            "Restrict results to one record lane. Looking for a FILE or a SYMBOL — 'where does X live', 'which file exports Y' — pass \"agents\" to search the terse per-file records directly. Asking how something WORKS, or any conceptual question, leave it unset: the filter measurably hurts those queries by hiding the prose that answers them. \"doc\" is topic/spec prose, \"source-md\" is markdown living beside source.",
        }),
      ),
      // Free string, NOT a strict Literal union: an unknown/malformed value must
      // fall back to condensed in-body, never hard-reject before execute() runs.
      format: Type.Optional(Type.String({ default: "condensed", description: "Output format: 'condensed' (default) or 'json' (compact, retains raw score)." })),
    }),
    async execute(_id: string, params: { query: string; limit?: number; doc_type?: "doc" | "agents" | "source-md"; format?: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: Ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      // In-body allowlist: only exact lowercase "json" selects JSON; all else → condensed.
      const fmt = params.format === "json" ? "json" : "condensed";
      const query = typeof params.query === "string" ? params.query : "";
      // Empty-query guard AFTER the format parse so it emits a format-appropriate marker.
      if (!query.trim()) return { content: [{ type: "text", text: fmt === "json" ? "[]" : "(no query)" }], details: { hits: 0 } };
      const limit = Number.isFinite(Number(params.limit)) ? Math.min(100, Math.max(1, Math.trunc(Number(params.limit)))) : 10;
      const docType = ["doc", "agents", "source-md"].includes(params.doc_type as string) ? params.doc_type : undefined;
      // Freshness reindex (awaited so search sees fresh data). Guarded: a failed
      // walk must not break the search — fall back to the existing index, matching
      // the debounce path's graceful `.catch`. See change: fix-kb-index-feedback.
      try {
        await reindexNow(state, cwd);
      } catch (e) {
        console.warn(`[kb] freshness reindex failed, searching existing index: ${(e as Error).message}`);
      }
      const { store, cfg } = getKb(state, cwd);
      // One shared mapping (design D2, fix-kb-eval-measurement-integrity).
      // expandGraph:false + rerank:false are this tool's long-standing behaviour
      // (never expand/rerank), now written down as explicit overrides instead of
      // a silent omission.
      const hits = store.search(
        query,
        { limit, docType: docType as any, ...searchOptsFromConfig(cfg, { overrides: { expandGraph: false, rerank: false } }) },
      );
      // Post-search trust-verdict enrichment (arm A) — async stage OUTSIDE the
      // store (design D10); store.search() stays sync. Labels only: ordering is
      // byte-identical with enrichment on or off (D1). Default ON for `agents`
      // hits; prose hits report a null verdict, never a vacuous label. Bodies
      // come from DISK (verdict.ts bodyOf default): the store's chunks table is
      // FTS5 — every chunk fetch is a scan, and disk is what the row says now.
      // Guarded: a verdict failure must never break the search itself.
      try {
        await enrichHits(hits, { cwd });
      } catch (e) {
        console.warn(`[kb] verdict enrichment failed: ${(e as Error).message}`);
      }
      const text = fmt === "json"
        ? JSON.stringify(hits.map((h, i) => ({ ...h, rank: i + 1 })))
        : renderHits(hits, { leading: "rank", parentGlyph: "\u2937 ", multiline: true });
      return { content: [{ type: "text", text }], details: { hits: hits.length } };
    },
  });

  pi.registerTool({
    name: "kb_neighbors",
    label: "KB Neighbors",
    description: "Walk the Tier-1 knowledge graph from a heading/file node. Returns connected nodes within depth.",
    parameters: Type.Object({
      node: Type.String({ description: "heading_path or file path" }),
      depth: Type.Optional(Type.Number({ default: 2 })),
    }),
    async execute(_id: string, params: { node: string; depth?: number }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: Ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      // Cold-start populate: an active-but-uninitialized KB would otherwise
      // return empty here. Guarded like kb_search — a failed walk falls back to
      // the existing index. See change: fix-kb-neighbors-get-cold-start.
      try {
        await ensurePopulated(state, cwd);
      } catch (e) {
        console.warn(`[kb] cold-start populate failed, using existing index: ${(e as Error).message}`);
      }
      const { store } = getKb(state, cwd);
      const nodes = store.neighbors(params.node as string, (params.depth as number) ?? 2);
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }], details: { nodes: nodes.length } };
    },
  });

  pi.registerTool({
    name: "kb_get",
    label: "KB Get",
    description:
      "Fetch the full body of a markdown section by path (and optional heading_path). " +
      "A path-only fetch of a multi-section file returns the first section AND reports how many further sections exist — " +
      "it never silently hands back one arbitrary slice. Pass `section` (the full `headingPath` from `kb_search` JSON output) to address one.",
    parameters: Type.Object({
      path: Type.String(),
      section: Type.Optional(Type.String({ description: "heading_path breadcrumb" })),
    }),
    async execute(_id: string, params: { path: string; section?: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: Ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      // Cold-start populate (see kb_neighbors). See change: fix-kb-neighbors-get-cold-start.
      try {
        await ensurePopulated(state, cwd);
      } catch (e) {
        console.warn(`[kb] cold-start populate failed, using existing index: ${(e as Error).message}`);
      }
      const { store, cfg } = getKb(state, cwd);
      const root = cfg.resolvedSources[0]?.id ?? "";
      const chunk = store.getChunk(root, params.path as string, params.section as string | undefined);
      // Non-silent truncation (design D7): 53 of 636 indexed AGENTS files have
      // >1 chunk, so a bare first-chunk body used to lie about being the file.
      const more = chunk?.suppressedSections ?? 0;
      const text = chunk
        ? more > 0
          ? `${chunk.body}\n\n(+${more} more section${more === 1 ? "" : "s"} in this file — pass \`section\` to fetch one)`
          : chunk.body
        : `(not found: ${params.path})`;
      return { content: [{ type: "text", text }], details: { found: !!chunk, suppressedSections: more } };
    },
  });

  // --- tool_call hook: opt-in push mode surfaces nearest AGENTS.md (2b.5) ---

  if (dirAgentsPush) {
    pi.on("tool_call", async (event, ctx) => {
      const toolName = (event as { toolName?: string }).toolName;
      if (!WRITE_TOOLS.has(toolName ?? "")) return;
      const p = (event as { input?: { path?: string } }).input?.path;
      if (typeof p !== "string" || !p) return;
      const cwd = (ctx as { cwd?: string })?.cwd ?? process.cwd();
      const { chain } = agentsChain(cwd, p, { claudeMd: true });
      if (!chain.length) return;
      const nearest = chain[chain.length - 1];
      try {
        const body = readFileSync(nearest.path, "utf8");
        (pi as unknown as { sendMessage: (m: unknown, o?: unknown) => void }).sendMessage(
          { customType: "kb-agents-push", content: `Local contract for ${p} — ${nearest.rel}:`, display: true, details: { agentsFile: nearest.rel, body } },
          { deliverAs: "steer", triggerTurn: false },
        );
      } catch { /* */ }
    });
  }

  // --- search guard (arm B): OWN tool_call hook — the push-mode hook above is
  // gated inside dirAgentsPush and is deliberately NOT reused (task 5.2). Fed
  // exactly once per invocation, HERE; tool_result never double-counts.

  pi.on("tool_call", async (event) => {
    const v = guardNoteSafe(guard, (event as { toolName?: string }).toolName ?? "", (event as { input?: GuardInput }).input);
    if (!v) return;
    if (typeof v === "string") {
      const id = (event as { toolCallId?: string }).toolCallId;
      if (id) rememberGuardWarning(id, v); // advisory: prepend to the result
      return;
    }
    return v; // { block: true, reason } — tool_call is the only hook that blocks
  });

  pi.on("tool_result", async (event) => {
    try {
      const id = (event as { toolCallId?: string }).toolCallId;
      const warn = id ? pendingGuardWarnings.get(id) : undefined;
      if (id) pendingGuardWarnings.delete(id);
      if (!warn) return;
      const content = (event as { content?: Array<{ type: string; text?: string }> }).content;
      const base = Array.isArray(content) ? content : [];
      return { content: [{ type: "text", text: warn }, ...base] }; // prepend (5.3)
    } catch {
      return undefined; // degrade silently (X1): result untouched
    }
  });

  pi.on("turn_start", async () => {
    guard?.tickTurn(); // D9: the pause clock ticks once per model turn
  });

  // --- kb_guard_pause: agent self-service suspension (D9, task 5.4) ---

  pi.registerTool({
    name: "kb_guard_pause",
    label: "KB Guard Pause",
    description:
      "Suspend the kb read-discipline guard for 1–20 model turns (agent self-service — no human approval). " +
      "Intended for legitimate bulk exploration the guard would mis-fire on: deep refactors, log triage, bulk renames. " +
      "The pause ticks down once per model turn; expiry restores a clean slate. Re-suspending never shortens an active pause.",
    parameters: Type.Object({
      turns: Type.Number({ description: "Model turns to suspend the guard (1–20; clamped)" }),
    }),
    async execute(_id: string, params: { turns: number }) {
      const n = guard?.suspend(params.turns) ?? 0;
      const text = n > 0 ? `kb guard suspended for ${n} turn${n === 1 ? "" : "s"}.` : "kb guard is not active or the request was invalid — no change.";
      return { content: [{ type: "text", text }], details: { suspended: n } };
    },
  });

  // --- tool_result hook: Job 1 (reindex) + Job 2 (DOX nudge) ---

  pi.on("tool_result", async (event, ctx) => {
    const toolName = (event as { toolName?: string }).toolName;
    if (!WRITE_TOOLS.has(toolName ?? "")) return;
    const input = (event as { input?: { path?: string; command?: string } }).input;
    const p = input?.path;
    if (!p && toolName === "bash" && input?.command) {
      // best-effort: don't parse bash for edits; only handle write/edit paths
      return;
    }
    if (typeof p !== "string" || !p) return;
    const cwd = (ctx as { cwd?: string })?.cwd ?? process.cwd();

    if (isMd(p)) {
      scheduleReindex(state, cwd, p);
      if (isAgents(p)) acknowledgeRows(cwd, p);
      return;
    }
    if (doxEnforcement) {
      const decision = decideNudge(cwd, p);
      if (!decision) return;
      const key = `${decision.kind}:${p}`;
      if (state.nudged.has(key)) return; // dedup: one nudge per path until acknowledged
      state.nudged.add(key);
      const text = nudgeText(decision, p);
      if (text) {
        try {
          (pi as unknown as { sendMessage: (m: unknown, o?: unknown) => void }).sendMessage(
            { customType: "kb-dox-nudge", content: text, display: true, details: { kind: decision.kind, path: p } },
            { deliverAs: "steer", triggerTurn: true },
          );
        } catch (e) { console.warn(`[kb] nudge send failed: ${(e as Error).message}`); }
      }
    }
  });

  pi.on("session_shutdown", async () => {
    closeKb(state);
  });
}

export { acknowledgeRows, closeKb, closeKbForCwd, createReindexState, decideNudge, ensurePopulated, getKb, nudgeText, reindexNow, scheduleReindex } from "./reindex.js";
