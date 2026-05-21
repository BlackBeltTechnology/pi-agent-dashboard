import type { ToolRenderer } from "./types.js";
import { ReadToolRenderer } from "./ReadToolRenderer.js";
import { EditToolRenderer } from "./EditToolRenderer.js";
import { WriteToolRenderer } from "./WriteToolRenderer.js";
import { BashToolRenderer } from "./BashToolRenderer.js";
import { AgentToolRenderer } from "./AgentToolRenderer.js";
import { GenericToolRenderer } from "./GenericToolRenderer.js";
import { AskUserToolRenderer } from "./AskUserToolRenderer.js";

const renderers = new Map<string, ToolRenderer>([
  ["read", ReadToolRenderer],
  ["edit", EditToolRenderer],
  ["write", WriteToolRenderer],
  ["bash", BashToolRenderer],
  ["Agent", AgentToolRenderer],
  ["ask_user", AskUserToolRenderer],
]);

/** Register a custom renderer for a tool name */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  renderers.set(toolName, renderer);
}

/** Get the renderer for a tool, falling back to GenericToolRenderer */
export function getToolRenderer(toolName: string): ToolRenderer {
  return renderers.get(toolName) ?? GenericToolRenderer;
}
