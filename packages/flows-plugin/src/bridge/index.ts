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
 * Claude subscription compat: registers the docs-section rewrite
 * (`claude-compat.ts`) on this session and hands the same factory to pi-flows
 * via `flow:register-agent-extension`, so spawned flow agents get it too.
 * The factory is created once at module level (pi-flows dedupes by
 * reference) and re-announced on every `session_start`, because pi-flows may
 * re-seed its list on `/reload` and may subscribe after this bridge loads.
 *
 * See change: route-flow-asks-to-upper-slot, retire-anthropic-messages-bridge.
 */
import { claudeCompatExtension, readSwitchFromEvents } from "./claude-compat.js";
import { startFlowFilesReporter } from "./flow-files-reporter.js";
import { FlowQuestionAdapter } from "./flow-question-adapter.js";

// Bound to the latest activating (parent) session's probe. Agents never probe
// their own bus: the dashboard listener lives only on the parent.
let readParentSwitch: () => boolean = () => false;
const claudeCompatAgentFactory = claudeCompatExtension(() => readParentSwitch());

/** The stable agent-extension factory announced to pi-flows (exported for tests). */
export function getClaudeCompatAgentFactory(): (pi: unknown) => void {
  return claudeCompatAgentFactory as (pi: unknown) => void;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: { events?: { emit: (name: string, payload: unknown) => void } }; events?: unknown };
  const pi = c?.pi ?? c;
  const events = (pi as { events?: { emit: (name: string, payload: unknown) => void } })?.events;
  if (!events || typeof events.emit !== "function") return;
  events.emit("prompt:register-adapter", new FlowQuestionAdapter());

  // Claude subscription compat (main session + flow agents).
  // See change: retire-anthropic-messages-bridge (design D5).
  readParentSwitch = readSwitchFromEvents(events);
  const piOn = pi as { on?: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => unknown };
  if (typeof piOn.on === "function") {
    claudeCompatExtension(() => readParentSwitch())(piOn as Parameters<ReturnType<typeof claudeCompatExtension>>[0]);
    piOn.on("session_start", () => announceAgentFactory(events));
  }
  announceAgentFactory(events);
  // Report this session's flow / agent / handler files to the plugin server so
  // the UI can open them. See change: attach-flow-before-run.
  startFlowFilesReporter(pi as Parameters<typeof startFlowFilesReporter>[0]);
}

function announceAgentFactory(events: { emit: (name: string, payload: unknown) => void }): void {
  try {
    events.emit("flow:register-agent-extension", { factory: claudeCompatAgentFactory });
  } catch {
    /* never throw from a re-announce */
  }
}
