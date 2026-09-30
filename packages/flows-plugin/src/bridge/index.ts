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
 * Also starts the flow-files reporter (see `flow-files-reporter.ts`).
 *
 * See change: route-flow-asks-to-upper-slot.
 */
import { startFlowFilesReporter } from "./flow-files-reporter.js";
import { FlowQuestionAdapter } from "./flow-question-adapter.js";

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: { events?: { emit: (name: string, payload: unknown) => void } }; events?: unknown };
  const pi = c?.pi ?? c;
  const events = (pi as { events?: { emit: (name: string, payload: unknown) => void } })?.events;
  if (!events || typeof events.emit !== "function") return;
  events.emit("prompt:register-adapter", new FlowQuestionAdapter());
  // Report this session's flow / agent / handler files to the plugin server so
  // the UI can open them. See change: attach-flow-before-run.
  startFlowFilesReporter(pi as Parameters<typeof startFlowFilesReporter>[0]);
}
