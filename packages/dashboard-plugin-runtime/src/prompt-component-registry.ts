/**
 * Client-side component registry for PromptBus.
 *
 * Maps component type strings to metadata about how to render prompts.
 * Built-in types:
 *   - "generic-dialog"    — default interactive dialog, inline placement
 *   - "architect-prompt"  — widget-bar placement
 *
 * Plugins register additional types at client init time:
 *   import { registerPromptComponent } from "@blackbelt-technology/dashboard-plugin-runtime";
 *   registerPromptComponent({ type: "flow-question", placement: "widget-bar" });
 *
 * Moved from `packages/client/src/lib/prompt-component-registry.ts` so
 * plugin packages can register without crossing the shell boundary.
 *
 * See change: route-flow-asks-to-upper-slot.
 */

export interface PromptComponentInfo {
  /** Component type identifier */
  type: string;
  /** Where this component renders */
  placement: "inline" | "widget-bar" | "overlay";
}

const registry = new Map<string, PromptComponentInfo>();

// Register built-in generic dialog
registry.set("generic-dialog", {
  type: "generic-dialog",
  placement: "inline",
});

// Register architect prompt (widget bar rendering)
registry.set("architect-prompt", {
  type: "architect-prompt",
  placement: "widget-bar",
});

/**
 * Get component info by type. Falls back to generic-dialog for unknown types.
 */
export function getPromptComponentInfo(type: string): PromptComponentInfo {
  return registry.get(type) ?? registry.get("generic-dialog")!;
}

/**
 * Register a custom prompt component type. Re-registration replaces the
 * prior entry without throwing (idempotent under HMR / module remount).
 */
export function registerPromptComponent(info: PromptComponentInfo): void {
  registry.set(info.type, info);
}

/**
 * Check if a prompt should render in the widget bar (vs inline in chat).
 */
export function isWidgetBarPrompt(componentType: string): boolean {
  const info = getPromptComponentInfo(componentType);
  return info.placement === "widget-bar";
}

/**
 * Reactive hook: returns `true` when the session has at least one pending
 * PromptBus request whose component type is registered with
 * `placement: "widget-bar"`. Plugin-agnostic suppression primitive consumed
 * by the shell (`SessionCard`, `ChatView`) and any other surface that needs
 * to skip showing chat indicators when a widget-bar slot owns the prompt.
 *
 * Returns `false` outside a `<PluginContextProvider>` (soft contract;
 * matches `useSessionInteractiveRequests`).
 *
 * See change: fix-flows-plugin-polish (B1).
 */
import { useSessionInteractiveRequests } from "./plugin-context.js";

export function useHasWidgetBarPrompt(sessionId: string): boolean {
  const requests = useSessionInteractiveRequests(sessionId);
  for (const req of requests) {
    if (req.status !== "pending") continue;
    const cmp = (req.params as Record<string, unknown>)._promptBusComponent as
      | { type?: string }
      | undefined;
    if (cmp?.type && isWidgetBarPrompt(cmp.type)) return true;
  }
  return false;
}
