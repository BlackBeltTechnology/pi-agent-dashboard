/**
 * FlowQuestionAdapter — PromptBus adapter that claims prompts originating
 * inside a running flow step (carrying `metadata.flowId`) so they render
 * in the FlowDashboard's upper slot instead of the chat stream.
 *
 * Lives in the flows-plugin bridge entry. Auto-loaded by pi when the
 * dashboard server registers the plugin's bridge path into pi's
 * `settings.json#dashboardPluginBridges` + `packages[]` via the standard
 * `discoverPlugins → registerAllPluginBridges` pipeline.
 *
 * Registration: the bridge entry (`./index.ts`) emits
 * `pi.events.emit("prompt:register-adapter", new FlowQuestionAdapter())`.
 * The main dashboard bridge listens for that event and calls
 * `promptBus.registerAdapter(adapter)` (see `packages/extension/src/bridge.ts`
 * around the `prompt:register-adapter` handler). PromptBus sorts adapters by
 * `priority` (lower first); we use 100 so this adapter beats
 * `DashboardDefaultAdapter` (priority 9999).
 *
 * See change: route-flow-asks-to-upper-slot.
 */

// Structural typing — avoid a hard dep on the main bridge package. The shape
// matches `PromptAdapter` / `PromptRequest` / `PromptClaim` /
// `PromptResponse` in `packages/extension/src/prompt-bus.ts` byte-for-byte.

interface PromptRequest {
  id: string;
  pipeline: string;
  type: "select" | "input" | "confirm" | "editor" | "multiselect";
  question: string;
  options?: string[];
  defaultValue?: string;
  metadata?: Record<string, unknown>;
}

interface PromptResponse {
  id: string;
  answer?: string;
  cancelled?: boolean;
  source: string;
}

interface PromptComponent {
  type: string;
  props: Record<string, unknown>;
}

interface PromptClaim {
  component?: PromptComponent;
  placement?: "widget-bar" | "inline" | "overlay";
}

interface PromptAdapter {
  name: string;
  priority?: number;
  onRequest(prompt: PromptRequest): PromptClaim | null | undefined | void;
  onResponse(response: PromptResponse): void;
  onCancel(id: string): void;
}

export class FlowQuestionAdapter implements PromptAdapter {
  readonly name = "flow-question";
  readonly priority = 100;

  onRequest(prompt: PromptRequest): PromptClaim | null {
    const flowId = prompt.metadata?.flowId;
    if (typeof flowId !== "string" || flowId.length === 0) return null;
    const stepId = typeof prompt.metadata?.stepId === "string" ? prompt.metadata.stepId : "";
    return {
      component: {
        type: "flow-question",
        props: {
          flowId,
          stepId,
          question: prompt.question,
          type: prompt.type,
          options: prompt.options,
          defaultValue: prompt.defaultValue,
        },
      },
      placement: "widget-bar",
    };
  }

  onResponse(_response: PromptResponse): void {
    // No adapter-owned UI to dismiss — the client tears down the card on
    // submit; the bus broadcasts `prompt_dismiss` for all listeners.
  }

  onCancel(_id: string): void {
    // No adapter-owned UI to dismiss.
  }
}
