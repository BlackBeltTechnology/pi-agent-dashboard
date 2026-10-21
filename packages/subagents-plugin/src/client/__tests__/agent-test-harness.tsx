/**
 * Test harness for the moved `AgentToolRenderer`: the host primitives the
 * renderer reads through `useUiPrimitive` (real client-utils `AgentCardShell` /
 * `Dialog` / `formatDuration`; stubs for the host-only `MarkdownContent` /
 * `ElapsedBadge`) plus an adapter from the built-in renderer's prop names
 * (`args`) to the plugin slot's (`toolInput`).
 *
 * See change: decouple-plugins-from-core (task 4.4).
 */

import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { AgentCardShell } from "@blackbelt-technology/pi-dashboard-client-utils/AgentCardShell";
import { formatDuration } from "@blackbelt-technology/pi-dashboard-client-utils/agent-card-utils";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { ToolRendererContext } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { UiPrimitiveMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { AgentToolRenderer as RealAgentToolRenderer } from "../AgentToolRenderer.js";
import type { SubagentState } from "../types.js";

export type ToolContext = ToolRendererContext;

const StubMarkdown: React.FC<{ content: string }> = ({ content }) => <div data-testid="md">{content}</div>;
const StubElapsedBadge: UiPrimitiveMap["ui:elapsed-badge"] = ({ startedAt, duration }) => (
  <span data-testid="elapsed-badge">{duration ?? startedAt ?? ""}</span>
);

export const HOST_PRIMITIVES: Partial<UiPrimitiveMap> = {
  "ui:agent-card": AgentCardShell as UiPrimitiveMap["ui:agent-card"],
  "ui:dialog": Dialog as unknown as UiPrimitiveMap["ui:dialog"],
  "ui:format-duration": formatDuration,
  "ui:markdown-content": StubMarkdown,
  "ui:elapsed-badge": StubElapsedBadge,
};

/** Wrap `ui` in a primitive provider carrying {@link HOST_PRIMITIVES} (plus overrides). */
export function withHostPrimitives(ui: React.ReactElement, overrides: Partial<UiPrimitiveMap> = {}): React.ReactElement {
  return withUiPrimitiveProvider({ ...HOST_PRIMITIVES, ...overrides }, ui);
}

type LegacyProps = {
  toolName: string;
  args?: Record<string, unknown>;
  status?: "running" | "complete" | "error" | "elided";
  result?: string;
  toolDetails?: Record<string, unknown>;
  context?: ToolContext;
};

/** The real renderer behind the built-in renderer's prop names (`args` → `toolInput`). */
export function AgentToolRenderer({ args, context, ...rest }: LegacyProps) {
  return (
    <RealAgentToolRenderer
      {...rest}
      toolInput={args ?? {}}
      sessionId={context?.sessionId ?? ""}
      pluginContext={undefined}
      context={context}
    />
  );
}

/** A session-state stand-in holding the given subagents (the renderer reads only `subagents`). */
function sessionWith(...subs: Array<Partial<SubagentState> & { id: string }>) {
  return {
    subagents: new Map(
      subs.map((s) => [s.id, { type: "Explore", description: "", status: "running", ...s } as SubagentState]),
    ),
  };
}
