/**
 * Main barrel export for @blackbelt-technology/dashboard-plugin-runtime.
 */
export * from "./slot-registry.js";
export * from "./slot-consumers.js";
export * from "./prompt-component-registry.js";
export {
  ShellSessionsProvider,
  useShellSession,
  useShellSessionOrNull,
  type ShellSessionsValue,
  type ShellSessionsProviderProps,
} from "./shell-sessions-context.js";
export * from "./dependency-graph.js";
export * from "./slot-error-boundary.js";
export {
  PluginContextProvider,
  CurrentPluginLayer,
  useSessionEvents,
  useSessionData,
  useSessionState,
  useSessionInteractiveRequests,
  useSessionSubagents,
  useShellConnectionStatus,
  useAllSessions,
  usePluginSend,
  usePluginRouter,
  usePluginConfig,
  usePluginLogger,
} from "./plugin-context.js";
export type { InteractiveUiRequestSnapshot, SubagentStateSnapshot } from "./plugin-context.js";
export type { PluginContextProviderProps, PluginLogger, PluginRouter } from "./plugin-context.js";
export { publishSessionEvent, clearSessionEvents } from "./session-events-store.js";
export { intentStore, useSlotIntents, IntentStore, keyToString } from "./intent-store.js";
export type { IntentKey, IntentStoreEntry } from "./intent-store.js";
export { IntentRenderer, UnknownPrimitive, isIntentNode } from "./intent-renderer.js";
export type { IntentRendererProps, IntentActionSender } from "./intent-renderer.js";
export { setSender, sendPluginAction } from "./plugin-action-bridge.js";
export {
  publishSessionData,
  clearSessionData,
  subscribeSessionDataKey,
  getSessionData,
  __resetSessionDataStoreForTests,
} from "./session-data-store.js";
export {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "./ui-primitive-registry.js";
export type { UiPrimitiveRegistry } from "./ui-primitive-registry.js";
export {
  UiPrimitiveProvider,
  useUiPrimitive,
  useUiPrimitiveOrNull,
} from "./ui-primitive-context.js";
export type { UiPrimitiveProviderProps } from "./ui-primitive-context.js";
