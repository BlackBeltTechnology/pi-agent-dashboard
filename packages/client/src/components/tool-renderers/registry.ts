import type { ToolRenderer } from "./types.js";
import { ReadToolRenderer } from "./ReadToolRenderer.js";
import { EditToolRenderer } from "./EditToolRenderer.js";
import { WriteToolRenderer } from "./WriteToolRenderer.js";
import { BashToolRenderer } from "./BashToolRenderer.js";
import { GenericToolRenderer } from "./GenericToolRenderer.js";
import { AskUserToolRenderer } from "./AskUserToolRenderer.js";
import { CtxToolRenderer } from "./CtxToolRenderer.js";

const renderers = new Map<string, ToolRenderer>([
  ["read", ReadToolRenderer],
  ["edit", EditToolRenderer],
  ["write", WriteToolRenderer],
  ["bash", BashToolRenderer],
  ["ask_user", AskUserToolRenderer],
  ["ctx_execute", CtxToolRenderer],
  ["ctx_execute_file", CtxToolRenderer],
  ["ctx_batch_execute", CtxToolRenderer],
  ["ctx_search", CtxToolRenderer],
  ["ctx_index", CtxToolRenderer],
  ["ctx_fetch_and_index", CtxToolRenderer],
  ["ctx_insight", CtxToolRenderer],
]);

/** Register a custom renderer for a tool name */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  renderers.set(toolName, renderer);
}

/**
 * Get the renderer for a tool, falling back to GenericToolRenderer.
 *
 * Any unmapped tool whose name begins with `ctx_` routes to `CtxToolRenderer`
 * (rendered as a raw card) so new context-mode tools (`ctx_stats`, `ctx_doctor`,
 * `ctx_purge`, …) need no code change. See change: add-ctx-tool-renderer (Decision 4).
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  const mapped = renderers.get(toolName);
  if (mapped) return mapped;
  if (toolName.startsWith("ctx_")) return CtxToolRenderer;
  return GenericToolRenderer;
}
