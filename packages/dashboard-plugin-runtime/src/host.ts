/**
 * HOST-ONLY surface of `@blackbelt-technology/dashboard-plugin-runtime/host`.
 *
 * Shell internals consumed by `packages/client` (slot consumers, registry,
 * providers, stores, intent renderer, graph helpers) and by plugin TESTS that
 * need to mount a shell. Not import-mapped, not part of the host API snapshot.
 * Plugin production code SHALL NOT import it (boundary gate). The package root
 * re-exports these names as `@deprecated` for one minor release.
 *
 * See change: decouple-plugins-from-core.
 */

export {
  claimsToRouteDescriptors,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
export {
  buildGraph,
  computeToggleImpact,
  detectCycles,
  type Graph,
  type GraphNode,
  type ToggleImpact,
  topologicalSort,
  transitiveDependencies,
  transitiveDependents,
} from "./dependency-graph.js";
export {
  EditorPaneTabLabelSlot,
  EditorPaneTabSlot,
  type EditorPaneTabSlotProps,
  findEditorPaneTabClaim,
  useEditorPaneTabClaim,
} from "./editor-pane-tab.js";
export {
  createReturnTargetStore,
  EmbeddedAppReturnPill,
  EmbeddedAppShellProvider,
  isSafeDashboardPath,
  type ReturnTarget,
  type ReturnTargetStore,
  returnPillLabel,
} from "./embedded-app-shell.js";
export {
  createFolderMenuStore,
  FOLDER_MENU_GROUPS,
  FolderMenuProvider,
  type FolderMenuStore,
  isFolderMenuGroup,
  isValidFolderMenuContribution,
  type RegisteredFolderMenuItem,
  selectFolderMenuItems,
  useFolderMenuItems,
  useFolderMenuRefreshRunner,
  useFolderMenuStore,
} from "./folder-menu-contributions.js";
export {
  clearFolderProjects,
  FOLDER_PROJECT_ERROR_TTL_MS,
} from "./folder-project.js";
export {
  type IntentActionSender,
  IntentRenderer,
  type IntentRendererProps,
  isIntentNode,
  UnknownPrimitive,
} from "./intent-renderer.js";
export {
  type IntentKey,
  IntentStore,
  type IntentStoreEntry,
  intentStore,
  keyToString,
  useSlotIntents,
} from "./intent-store.js";
export {
  createOAuthFlowClient,
} from "./oauth-flow-client.js";
export {
  setSender,
} from "./plugin-action-bridge.js";
export {
  applyPluginConfigUpdate,
  CurrentPluginLayer,
  EMPTY_SUBAGENTS,
  getPluginConfig,
  initPluginConfigs,
  PluginContextProvider,
  type PluginContextProviderProps,
  useSlotRegistry,
  useSlotRegistryOrNull,
} from "./plugin-context.js";
export {
  getPromptComponentInfo,
  isWidgetBarPrompt,
  type PromptComponentInfo,
  useHasWidgetBarPrompt,
} from "./prompt-component-registry.js";
export {
  SLOT_PILL_LEGEND,
} from "./SlotPill.js";
export {
  randomUuid,
} from "./secure-context.js";
export {
  clearSessionData,
  publishSessionData,
  subscribeSessionDataKey,
} from "./session-data-store.js";
export {
  findSessionEventReducer,
  findToolRowFinalizer,
  registerSessionEventReducer,
  registerToolRowFinalizer,
  setSessionReducerEnabledSet,
  unregisterSessionReducers,
} from "./session-event-reducers.js";
export {
  clearSessionEvents,
  publishSessionEvent,
  publishSessionEvents,
} from "./session-events-store.js";
export {
  PluginSettingsPageProvider,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
  usePluginSettingsPageId,
} from "./settings-draft-context.js";
export {
  ShellSessionsProvider,
  type ShellSessionsProviderProps,
  type ShellSessionsValue,
  useShellSession,
  useShellSessionOrNull,
} from "./shell-sessions-context.js";
export {
  getSlotClaimsVersion,
  subscribeSlotClaimsVersion,
  useSlotClaimsVersion,
} from "./slot-claims-invalidation.js";
export {
  AnchoredPopoverSlot,
  CommandRouteSlot,
  ComposerContextGroupSlot,
  ComposerPanelSlot,
  ContentHeaderStickySlot,
  ContentInlineFooterSlot,
  ContentViewSlot,
  ResourcePageSectionSlot,
  SessionCardActionBarSlot,
  SessionCardBadgeSlot,
  SessionCardFlowsSlot,
  SessionCardMemorySlot,
  SettingsSectionByPluginSlot,
  SettingsSectionSlot,
  ShellHeadlessSlot,
  ShellOverlayRouteSlot,
  SidebarFolderSectionSlot,
  ToolbarGroup,
  ToolRendererSlot,
  useShellOverlayRouteDepth,
  useShellOverlayRouteMatched,
  useShellOverlayRoutePresentation,
  useSlotHasAnyClaims,
  useSlotHasClaimsForSession,
  useSlotHasVisibleClaimsForSession,
  useSlotPluginIds,
  WorkspaceActionBarSlot,
  WorktreeCardSectionSlot,
} from "./slot-consumers.js";
export {
  SlotErrorBoundary,
} from "./slot-error-boundary.js";
export {
  type ClaimEntry,
  createSlotRegistry,
  type FolderDescriptor,
  forActionId,
  forCommand,
  forCustomType,
  forFolder,
  forSession,
  forSessionRendered,
  forToolName,
  type PluginActivationSummary,
  type PluginSummary,
  type SlotRegistry,
} from "./slot-registry.js";
