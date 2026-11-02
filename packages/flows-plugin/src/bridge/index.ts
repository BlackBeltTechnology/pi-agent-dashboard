/**
 * flows-plugin · bridge entry.
 *
 * Auto-registered at `~/.pi/agent/settings.json#dashboardPluginBridges`
 * (key: `dashboard-flows`) when the dashboard server discovers the plugin
 * manifest and runs `registerAllPluginBridges`. The path is mirrored into
 * the top-level `packages[]` array so pi-coding-agent loads it as a pi
 * extension on the next session start.
 *
 * Behavior: on activation, emit a `prompt:register-adapter` event with
 * a fresh `FlowQuestionAdapter`. The main dashboard bridge listens for
 * that event and calls `promptBus.registerAdapter(adapter)` — see the
 * existing handler in `packages/extension/src/bridge.ts`. PromptBus
 * sorts adapters by `priority`; `FlowQuestionAdapter` (priority 100)
 * therefore claims flow-tagged prompts before `DashboardDefaultAdapter`
 * (priority 9999).
 *
 * Also starts the flow-files reporter (see `flow-files-reporter.ts`) and the
 * flow catalog publisher (see `flow-catalog-publisher.ts`; change
 * flows-dock-chip-and-panel-actions).
 *
 * Claude subscription compat for flow agents: pi-flows builds agents with an
 * in-memory loader that never loads the settings packages, so the dashboard
 * extension's own registration misses them. This bridge announces one stable
 * compat factory on pi-flows' spawn hook (`flow:register-agent-extension`) on
 * activate and every `session_start` (pi-flows dedupes by reference and may
 * re-seed on `/reload`). See change: restore-flow-agent-claude-compat.
 *
 * See change: route-flow-asks-to-upper-slot.
 */
import { claudeCompatExtension } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";
import { startFlowCatalogPublisher } from "./flow-catalog-publisher.js";
import { startFlowFilesReporter } from "./flow-files-reporter.js";
import { FlowQuestionAdapter } from "./flow-question-adapter.js";

// Switch value the dashboard extension mirrors process-globally on
// `preferences_update` (`packages/extension/src/bridge.ts` BRIDGE_KEY). Flow
// agents run in this process. Absent bridge or value → off.
const readSwitch = (): boolean =>
  (process as unknown as { __pi_dashboard_bridge__?: { claudeSubscriptionCompat?: boolean } }).__pi_dashboard_bridge__
    ?.claudeSubscriptionCompat === true;
const claudeCompatAgentFactory = claudeCompatExtension(readSwitch);

function announceAgentFactory(events: { emit: (name: string, payload: unknown) => void }): void {
  try {
    events.emit("flow:register-agent-extension", { factory: claudeCompatAgentFactory });
  } catch {
    /* never throw from an announce */
  }
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: { events?: { emit: (name: string, payload: unknown) => void } }; events?: unknown };
  const pi = c?.pi ?? c;
  const events = (pi as { events?: { emit: (name: string, payload: unknown) => void } })?.events;
  if (!events || typeof events.emit !== "function") return;
  events.emit("prompt:register-adapter", new FlowQuestionAdapter());

  announceAgentFactory(events);
  const piOn = pi as { on?: (name: string, handler: () => void) => unknown };
  if (typeof piOn.on === "function") piOn.on("session_start", () => announceAgentFactory(events));

  // Report this session's flow / agent / handler files to the plugin server so
  // the UI can open them. See change: attach-flow-before-run.
  startFlowFilesReporter(pi as Parameters<typeof startFlowFilesReporter>[0]);
  // Publish this session's flow catalog through declared event forwarding.
  // See change: flows-dock-chip-and-panel-actions.
  startFlowCatalogPublisher(pi as Parameters<typeof startFlowCatalogPublisher>[0]);
}
