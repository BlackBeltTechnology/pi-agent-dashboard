/**
 * Main barrel export for @blackbelt-technology/dashboard-plugin-runtime.
 */

// Re-exported from shared so the runtime keeps a single public surface; the
// implementation lives in shared to avoid a worktree dual-instance split.
// See change: fix-plugin-and-scoped-back-navigation.
export { claimsToRouteDescriptors } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
export * from "./dependency-graph.js";
export type { IntentActionSender, IntentRendererProps } from "./intent-renderer.js";
export { IntentRenderer, isIntentNode, UnknownPrimitive } from "./intent-renderer.js";
export type { IntentKey, IntentStoreEntry } from "./intent-store.js";
export { IntentStore, intentStore, keyToString, useSlotIntents } from "./intent-store.js";
export { sendPluginAction, setSender } from "./plugin-action-bridge.js";
export type { InteractiveUiRequestSnapshot, PluginContextProviderProps, PluginLogger, PluginRouter, SubagentStateSnapshot } from "./plugin-context.js";
export {
  CurrentPluginLayer,
  PluginContextProvider,
  useAllSessions,
  useLanguage,
  usePluginConfig,
  usePluginLogger,
  usePluginRouter,
  usePluginSend,
  useSessionData,
  useSessionEvents,
  useSessionInteractiveRequests,
  useSessionState,
  useSessionSubagents,
  useShellConnectionStatus,
  useT,
} from "./plugin-context.js";
export * from "./prompt-component-registry.js";
export {
  __resetSessionDataStoreForTests,
  clearSessionData,
  getSessionData,
  publishSessionData,
  subscribeSessionDataKey,
} from "./session-data-store.js";
export { clearSessionEvents, getSessionEvents, publishSessionEvent, publishSessionEvents } from "./session-events-store.js";
export type {
  RegisteredSource,
  SettingsDraftRegistry,
  SettingsDraftSource,
} from "./settings-draft-context.js";
export {
  SettingsDraftProvider,
  useSettingsDraftSource,
} from "./settings-draft-context.js";
export {
  ShellSessionsProvider,
  type ShellSessionsProviderProps,
  type ShellSessionsValue,
  useShellSession,
  useShellSessionOrNull,
} from "./shell-sessions-context.js";
export * from "./slot-consumers.js";
export * from "./slot-error-boundary.js";
export * from "./slot-registry.js";
export type { UiPrimitiveProviderProps } from "./ui-primitive-context.js";
export {
  UiPrimitiveProvider,
  useUiPrimitive,
  useUiPrimitiveOrNull,
} from "./ui-primitive-context.js";
export type { UiPrimitiveRegistry } from "./ui-primitive-registry.js";
export {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "./ui-primitive-registry.js";
