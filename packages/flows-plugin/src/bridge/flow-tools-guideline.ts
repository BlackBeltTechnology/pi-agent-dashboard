/**
 * flows-plugin · `flow_write` guideline for the flow-tools facade.
 *
 * Before each agent run whose selected tools include pi-flows' `flow_write`
 * (flow edit mode on), appends ONE guideline telling the model how code-node
 * handlers reach the dashboard tool registry (see `flow-tool-registry.ts`).
 *
 * Dashboard-only by construction (roles-plugin `Agent` guideline pattern): this
 * ships only with the flows plugin, whose bridge is registered only while the
 * plugin is enabled — any project opened through the dashboard gets it; plain
 * pi-flows never does. Deduped, because a stale and a current bridge generation
 * can both fire after `/reload`. See change: add-flow-code-node-tools (D5).
 */
import { FLOW_TOOLS_SYMBOL_KEY } from "./flow-tool-registry.js";

export const FLOW_WRITE_TOOL = "flow_write";

export const FLOW_TOOLS_GUIDELINE =
  "Code handlers (code / code-decision nodes) can run any dashboard-registered tool (bash, git, node, npm, npx, gh, …) " +
  "through the pi-dashboard tool registry instead of running bare names off PATH. Guard and fall back, because the " +
  `facade exists only under the dashboard: \`const tools = (globalThis as any)[Symbol.for("${FLOW_TOOLS_SYMBOL_KEY}")]; ` +
  'if (tools) { const r = await tools.run("git", ["status"], { cwd: ctx.cwd, signal: ctx.signal }); } ' +
  "else { /* node:child_process fallback */ }`. Methods: `has(name)`, `resolve(name)` (absolute path or null; do not " +
  "execute it directly, use run), `await run(name, args, { cwd, env, timeoutMs, signal })`, `await shell(script, opts)` (registry " +
  "bash without login profiles). Results are `{ ok, code, stdout, stderr, out }` and never throw: 127 = tool not " +
  "found, 130 = aborted; output is capped at 64 MiB per stream. Address tools by name; there is no list().";

interface PromptOptionsLike {
  selectedTools?: string[];
  toolGuidelines?: Record<string, string[]>;
}

interface PiLike {
  on?: (event: string, handler: (event: unknown) => unknown) => unknown;
}

/** Register the per-run guideline injector. Never throws, never blocks a run. */
export function startFlowToolsGuideline(pi: PiLike): void {
  if (!pi || typeof pi.on !== "function") return;
  pi.on("before_agent_start", (event: unknown) => {
    try {
      const opts = (event as { systemPromptOptions?: PromptOptionsLike } | undefined)?.systemPromptOptions;
      if (!opts || !Array.isArray(opts.selectedTools) || !opts.selectedTools.includes(FLOW_WRITE_TOOL)) return;
      opts.toolGuidelines ??= {};
      const existing = opts.toolGuidelines[FLOW_WRITE_TOOL] ?? [];
      if (existing.includes(FLOW_TOOLS_GUIDELINE)) return;
      opts.toolGuidelines[FLOW_WRITE_TOOL] = [...existing, FLOW_TOOLS_GUIDELINE];
    } catch {
      /* guidance is best-effort; never block a run */
    }
  });
}
