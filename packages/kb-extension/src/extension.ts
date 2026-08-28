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
import { agentsChain, loadConfig, renderHits, searchOptsFromConfig } from "@blackbelt-technology/pi-dashboard-kb";
import { Type } from "typebox";
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
  try {
    const cfg = loadConfig(process.cwd());
    doxEnforcement = cfg.doxEnforcement;
    dirAgentsPush = cfg.directoryLevelAgents.enabled && cfg.directoryLevelAgents.mode === "push";
  } catch { /* no config → both off */ }
  if (process.env.KB_DOX_ENFORCEMENT === "1") doxEnforcement = true;

  // --- native tools (pull retrieval) ---

  pi.registerTool({
    name: "kb_search",
    label: "KB Search",
    description:
      "Search the local markdown knowledge base (FTS5 + BM25) for ranked sections before answering from memory. " +
      "Default output is condensed text, one block per hit: `<rank>  <path>  ::  <leafHeading>`, an optional `(+N dup)` " +
      "duplicate-copy marker, an optional `(+N more sections)` marker counting further matching sections of that SAME file, " +
      "an optional `⤷ <parentHeading>` continuation, then a one-line snippet. FTS match markers `[ ]` " +
      "in the snippet flag the terms that matched. `rank` is a 1-based ordinal over the returned hits (not a global score). " +
      "`limit` bounds DISTINCT SOURCES (files), not chunks — one entry per file, so a page of 10 names 10 different files. " +
      "Expand a file marked `(+N more sections)` with `kb_get(path)` / `kb_get(path, section)`. " +
      "Pass `format:\"json\"` for compact machine-readable JSON that also retains the raw BM25 `score` and the full `headingPath`.",
    promptSnippet: "Search the local markdown KB for ranked sections",
    promptGuidelines: [
      "Call kb_search FIRST for any project-specific factual / 'where is X' / 'how does Y work' question — before ctx_search, memory_search, grep, or reading source.",
      "kb_search indexes repo markdown (docs/, openspec/, packages/, .pi/). ctx_search/memory_search index session memory, not docs — different corpus. Fall through to grep/source only when kb_search returns nothing relevant.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Keyword / identifier / error-string terms to search" }),
      limit: Type.Optional(Type.Number({ default: 10 })),
      doc_type: Type.Optional(Type.Union([Type.Literal("doc"), Type.Literal("agents"), Type.Literal("source-md")])),
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
