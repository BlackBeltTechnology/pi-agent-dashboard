/**
 * DashboardDefaultAdapter — built-in adapter that renders all prompts
 * as generic interactive dialogs in the dashboard chat area.
 *
 * This is the fallback when no other adapter claims with a custom component.
 * Always registered — works without pi-flows.
 */

import type { PromptAdapter, PromptRequest, PromptResponse, PromptClaim } from "./prompt-bus.js";

export class DashboardDefaultAdapter implements PromptAdapter {
  readonly name = "dashboard-default";
  /**
   * Last-resort fallback. Any plugin adapter with default priority (1000)
   * or lower beats this. See change: route-flow-asks-to-upper-slot.
   */
  readonly priority = 9999;

  onRequest(_prompt: PromptRequest): PromptClaim {
    return {
      component: {
        type: "generic-dialog",
        props: {
          question: _prompt.question,
          type: _prompt.type,
          options: _prompt.options,
          defaultValue: _prompt.defaultValue,
        },
      },
      placement: "inline",
    };
  }

  onResponse(_response: PromptResponse): void {
    // Dismiss is handled by the bus via onDashboardDismiss callback.
    // No extra work needed here — the bus sends prompt_dismiss for us.
  }

  onCancel(_id: string): void {
    // Cleanup is handled by the bus via onDashboardCancel callback.
  }
}
