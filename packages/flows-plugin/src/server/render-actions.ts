/**
 * Pure render function: SessionFlowActions intent.
 *
 * Translates (flows, commands) into an intent tree for the
 * session-card-action-bar slot. No React, no DOM — just JSON.
 *
 * The intent uses a `ui:action-list` whose items each emit their own
 * action descriptor in the intent format. Items are NOT IntentNodes
 * themselves — they're plain data; the ActionList primitive turns
 * `onClick: ActionDescriptor` data into a real function via the
 * `IntentRenderer.actions` wiring.
 *
 * For per-item action wiring without IntentNode wrapping, we emit a
 * `data-action` field on the item, and the registered ActionList
 * primitive translates it to onClick. Alternatively, each button could
 * be its own IntentNode — but `ui:action-list` is meant as a high-
 * affinity primitive that takes a flat data array.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";

export interface RenderActionsInput {
  flows: FlowCatalogEntry[];
  commands: CommandInfo[];
}

/**
 * Action item shape as emitted by the plugin. The dashboard's ActionList
 * primitive component reads `dataAction` and calls a registered dispatcher
 * (set up by the shell via plugin-action-bridge) when clicked. This keeps
 * the data wire pure JSON.
 */
export interface RenderedActionItem {
  label: string;
  tooltip?: string;
  icon?: string;
  /** Server-side action descriptor. The shell wires this to a click. */
  dataAction?: {
    pluginId: string;
    action: string;
    payload?: Record<string, unknown>;
  };
  disabled?: boolean;
}

/**
 * Build the SessionFlowActions intent.
 *
 * Returns null when there are no flows AND no `/flows:new` command — the
 * slot stays empty in that case, matching legacy behaviour.
 */
export function renderSessionFlowActions(input: RenderActionsInput): IntentNode | null {
  const { flows, commands } = input;
  const hasNew = commands.some((c) => c.name === "flows:new");

  if (flows.length === 0 && !hasNew) return null;

  const actions: RenderedActionItem[] = [];

  for (const flow of flows) {
    actions.push({
      label: flow.name,
      tooltip: flow.description,
      dataAction: {
        pluginId: "flows",
        action: "flow.run",
        payload: { flow: flow.name },
      },
    });
  }

  if (hasNew) {
    actions.push({
      label: "+ New Flow",
      dataAction: {
        pluginId: "flows",
        action: "flow.new",
      },
    });
  }

  return {
    primitive: "ui:action-list",
    props: { actions } as unknown as Record<string, unknown>,
  };
}
