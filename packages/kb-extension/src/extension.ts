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
import { Type } from "typebox";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-kb";
import { agentsChain } from "@blackbelt-technology/pi-dashboard-kb";
import { readFileSync } from "node:fs";
import {
  createReindexState, getKb, scheduleReindex, acknowledgeRows,
  decideNudge, nudgeText, closeKb, reindexNow, type ReindexState,
} from "./reindex.js";

const WRITE_TOOLS = new Set(["write", "edit", "bash"]);
const AGENTS_NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

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
      "Search the local markdown knowledge base (FTS5 + BM25) for ranked sections before answering from memory. Returns {path, headingPath, score, snippet, akaPaths, parent}.",
    promptSnippet: "Search the local markdown KB for ranked sections",
    promptGuidelines: [
      "Call kb_search FIRST for any project-specific factual / 'where is X' / 'how does Y work' question — before ctx_search, memory_search, grep, or reading source.",
      "kb_search indexes repo markdown (docs/, openspec/, packages/, .pi/). ctx_search/memory_search index session memory, not docs — different corpus. Fall through to grep/source only when kb_search returns nothing relevant.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Entities / terms / error strings to search" }),
      limit: Type.Optional(Type.Number({ default: 10 })),
      doc_type: Type.Optional(Type.Union([Type.Literal("doc"), Type.Literal("agents"), Type.Literal("source-md")])),
    }),
    async execute(_id: string, params: { query: string; limit?: number; doc_type?: "doc" | "agents" | "source-md" }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: Ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      const query = typeof params.query === "string" ? params.query : "";
      if (!query.trim()) return { content: [{ type: "text", text: "[]" }], details: { hits: 0 } };
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
      const hits = store.search(query, {
        limit,
        docType: docType as any,
        fieldWeights: cfg.ranking.fieldWeights,
        proximityBoost: cfg.ranking.proximityBoost,
        diversity: cfg.ranking.diversity,
        expandParent: cfg.expand.parent,
        rootPriority: Object.fromEntries(cfg.resolvedSources.map((s: { id: string; priority: number }) => [s.id, s.priority])),
      });
      return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }], details: { hits: hits.length } };
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
      const { store } = getKb(state, cwd);
      const nodes = store.neighbors(params.node as string, (params.depth as number) ?? 2);
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }], details: { nodes: nodes.length } };
    },
  });

  pi.registerTool({
    name: "kb_get",
    label: "KB Get",
    description: "Fetch the full body of a markdown section by path (and optional heading_path).",
    parameters: Type.Object({
      path: Type.String(),
      section: Type.Optional(Type.String({ description: "heading_path breadcrumb" })),
    }),
    async execute(_id: string, params: { path: string; section?: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: Ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      const { store, cfg } = getKb(state, cwd);
      const root = cfg.resolvedSources[0]?.id ?? "";
      const chunk = store.getChunk(root, params.path as string, params.section as string | undefined);
      return { content: [{ type: "text", text: chunk?.body ?? `(not found: ${params.path})` }], details: { found: !!chunk } };
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
    let p = input?.path;
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

export { createReindexState, getKb, scheduleReindex, acknowledgeRows, decideNudge, nudgeText, closeKb, reindexNow } from "./reindex.js";
