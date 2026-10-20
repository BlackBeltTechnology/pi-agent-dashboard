/**
 * Main barrel export for @blackbelt-technology/dashboard-plugin-runtime.
 *
 * - `./public.ts` is the versioned host API surface (re-exported verbatim).
 * - The host-only names (`./host.ts`) are re-exported below as `@deprecated` for
 *   one package minor release so build-time consumers keep compiling. They are
 *   NOT part of `public.ts`, the import-map shim or the host API snapshot, and
 *   the boundary gate fails any in-repo plugin file that still imports one from
 *   here. `__reset*ForTests` helpers moved to `./test-support` (no root alias).
 *
 * See change: decouple-plugins-from-core (design D6).
 */


export {
  /** @deprecated Import `AnchoredPopoverSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  AnchoredPopoverSlot,
  /** @deprecated Import `applyPluginConfigUpdate` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  applyPluginConfigUpdate,
  /** @deprecated Import `buildGraph` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  buildGraph,
  /** @deprecated Import `ClaimEntry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ClaimEntry,
  /** @deprecated Import `CommandRouteSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  CommandRouteSlot,
  /** @deprecated Import `ComposerContextGroupSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ComposerContextGroupSlot,
  /** @deprecated Import `ComposerPanelSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ComposerPanelSlot,
  /** @deprecated Import `ContentHeaderStickySlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ContentHeaderStickySlot,
  /** @deprecated Import `ContentInlineFooterSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ContentInlineFooterSlot,
  /** @deprecated Import `ContentViewSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ContentViewSlot,
  /** @deprecated Import `CurrentPluginLayer` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  CurrentPluginLayer,
  /** @deprecated Import `claimsToRouteDescriptors` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  claimsToRouteDescriptors,
  /** @deprecated Import `clearFolderProjects` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  clearFolderProjects,
  /** @deprecated Import `clearSessionData` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  clearSessionData,
  /** @deprecated Import `clearSessionEvents` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  clearSessionEvents,
  /** @deprecated Import `computeToggleImpact` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  computeToggleImpact,
  /** @deprecated Import `createFolderMenuStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  createFolderMenuStore,
  /** @deprecated Import `createOAuthFlowClient` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  createOAuthFlowClient,
  /** @deprecated Import `createReturnTargetStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  createReturnTargetStore,
  /** @deprecated Import `createSlotRegistry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  createSlotRegistry,
  /** @deprecated Import `detectCycles` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  detectCycles,
  /** @deprecated Import `EditorPaneTabLabelSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  EditorPaneTabLabelSlot,
  /** @deprecated Import `EditorPaneTabSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  EditorPaneTabSlot,
  /** @deprecated Import `EditorPaneTabSlotProps` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type EditorPaneTabSlotProps,
  /** @deprecated Import `EmbeddedAppReturnPill` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  EmbeddedAppReturnPill,
  /** @deprecated Import `EmbeddedAppShellProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  EmbeddedAppShellProvider,
  /** @deprecated Import `FOLDER_MENU_GROUPS` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  FOLDER_MENU_GROUPS,
  /** @deprecated Import `FOLDER_PROJECT_ERROR_TTL_MS` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  FOLDER_PROJECT_ERROR_TTL_MS,
  /** @deprecated Import `FolderDescriptor` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type FolderDescriptor,
  /** @deprecated Import `FolderMenuProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  FolderMenuProvider,
  /** @deprecated Import `FolderMenuStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type FolderMenuStore,
  /** @deprecated Import `findEditorPaneTabClaim` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  findEditorPaneTabClaim,
  /** @deprecated Import `forActionId` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forActionId,
  /** @deprecated Import `forCommand` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forCommand,
  /** @deprecated Import `forCustomType` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forCustomType,
  /** @deprecated Import `forFolder` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forFolder,
  /** @deprecated Import `forSession` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forSession,
  /** @deprecated Import `forSessionRendered` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forSessionRendered,
  /** @deprecated Import `forToolName` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  forToolName,
  /** @deprecated Import `Graph` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type Graph,
  /** @deprecated Import `GraphNode` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type GraphNode,
  /** @deprecated Import `getPluginConfig` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  getPluginConfig,
  /** @deprecated Import `getPromptComponentInfo` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  getPromptComponentInfo,
  /** @deprecated Import `getSlotClaimsVersion` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  getSlotClaimsVersion,
  /** @deprecated Import `IntentActionSender` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type IntentActionSender,
  /** @deprecated Import `IntentKey` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type IntentKey,
  /** @deprecated Import `IntentRenderer` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  IntentRenderer,
  /** @deprecated Import `IntentRendererProps` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type IntentRendererProps,
  /** @deprecated Import `IntentStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  IntentStore,
  /** @deprecated Import `IntentStoreEntry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type IntentStoreEntry,
  /** @deprecated Import `initPluginConfigs` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  initPluginConfigs,
  /** @deprecated Import `intentStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  intentStore,
  /** @deprecated Import `isFolderMenuGroup` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  isFolderMenuGroup,
  /** @deprecated Import `isIntentNode` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  isIntentNode,
  /** @deprecated Import `isSafeDashboardPath` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  isSafeDashboardPath,
  /** @deprecated Import `isValidFolderMenuContribution` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  isValidFolderMenuContribution,
  /** @deprecated Import `isWidgetBarPrompt` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  isWidgetBarPrompt,
  /** @deprecated Import `keyToString` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  keyToString,
  /** @deprecated Import `PluginActivationSummary` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type PluginActivationSummary,
  /** @deprecated Import `PluginContextProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  PluginContextProvider,
  /** @deprecated Import `PluginContextProviderProps` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type PluginContextProviderProps,
  /** @deprecated Import `PluginSettingsPageProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  PluginSettingsPageProvider,
  /** @deprecated Import `PluginSummary` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type PluginSummary,
  /** @deprecated Import `PromptComponentInfo` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type PromptComponentInfo,
  /** @deprecated Import `publishSessionData` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  publishSessionData,
  /** @deprecated Import `publishSessionEvent` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  publishSessionEvent,
  /** @deprecated Import `publishSessionEvents` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  publishSessionEvents,
  /** @deprecated Import `RegisteredFolderMenuItem` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type RegisteredFolderMenuItem,
  /** @deprecated Import `RegisteredSource` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type RegisteredSource,
  /** @deprecated Import `ResourcePageSectionSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ResourcePageSectionSlot,
  /** @deprecated Import `ReturnTarget` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ReturnTarget,
  /** @deprecated Import `ReturnTargetStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ReturnTargetStore,
  /** @deprecated Import `randomUuid` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  randomUuid,
  /** @deprecated Import `returnPillLabel` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  returnPillLabel,
  /** @deprecated Import `SessionCardActionBarSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SessionCardActionBarSlot,
  /** @deprecated Import `SessionCardBadgeSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SessionCardBadgeSlot,
  /** @deprecated Import `SessionCardFlowsSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SessionCardFlowsSlot,
  /** @deprecated Import `SessionCardMemorySlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SessionCardMemorySlot,
  /** @deprecated Import `SettingsDraftProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SettingsDraftProvider,
  /** @deprecated Import `SettingsDraftRegistry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type SettingsDraftRegistry,
  /** @deprecated Import `SettingsSectionByPluginSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SettingsSectionByPluginSlot,
  /** @deprecated Import `SettingsSectionSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SettingsSectionSlot,
  /** @deprecated Import `ShellHeadlessSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ShellHeadlessSlot,
  /** @deprecated Import `ShellOverlayRouteSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ShellOverlayRouteSlot,
  /** @deprecated Import `ShellSessionsProvider` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ShellSessionsProvider,
  /** @deprecated Import `ShellSessionsProviderProps` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ShellSessionsProviderProps,
  /** @deprecated Import `ShellSessionsValue` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ShellSessionsValue,
  /** @deprecated Import `SidebarFolderSectionSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SidebarFolderSectionSlot,
  /** @deprecated Import `SLOT_PILL_LEGEND` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SLOT_PILL_LEGEND,
  /** @deprecated Import `SlotErrorBoundary` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  SlotErrorBoundary,
  /** @deprecated Import `SlotRegistry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type SlotRegistry,
  /** @deprecated Import `selectFolderMenuItems` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  selectFolderMenuItems,
  /** @deprecated Import `setSender` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  setSender,
  /** @deprecated Import `subscribeSessionDataKey` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  subscribeSessionDataKey,
  /** @deprecated Import `subscribeSlotClaimsVersion` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  subscribeSlotClaimsVersion,
  /** @deprecated Import `ToggleImpact` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  type ToggleImpact,
  /** @deprecated Import `ToolbarGroup` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ToolbarGroup,
  /** @deprecated Import `ToolRendererSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  ToolRendererSlot,
  /** @deprecated Import `topologicalSort` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  topologicalSort,
  /** @deprecated Import `transitiveDependencies` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  transitiveDependencies,
  /** @deprecated Import `transitiveDependents` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  transitiveDependents,
  /** @deprecated Import `UnknownPrimitive` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  UnknownPrimitive,
  /** @deprecated Import `useEditorPaneTabClaim` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useEditorPaneTabClaim,
  /** @deprecated Import `useFolderMenuItems` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useFolderMenuItems,
  /** @deprecated Import `useFolderMenuRefreshRunner` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useFolderMenuRefreshRunner,
  /** @deprecated Import `useFolderMenuStore` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useFolderMenuStore,
  /** @deprecated Import `useHasWidgetBarPrompt` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useHasWidgetBarPrompt,
  /** @deprecated Import `usePluginSettingsPageId` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  usePluginSettingsPageId,
  /** @deprecated Import `useShellOverlayRouteDepth` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useShellOverlayRouteDepth,
  /** @deprecated Import `useShellOverlayRouteMatched` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useShellOverlayRouteMatched,
  /** @deprecated Import `useShellOverlayRoutePresentation` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useShellOverlayRoutePresentation,
  /** @deprecated Import `useShellSession` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useShellSession,
  /** @deprecated Import `useShellSessionOrNull` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useShellSessionOrNull,
  /** @deprecated Import `useSlotClaimsVersion` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotClaimsVersion,
  /** @deprecated Import `useSlotHasAnyClaims` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotHasAnyClaims,
  /** @deprecated Import `useSlotHasClaimsForSession` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotHasClaimsForSession,
  /** @deprecated Import `useSlotHasVisibleClaimsForSession` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotHasVisibleClaimsForSession,
  /** @deprecated Import `useSlotIntents` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotIntents,
  /** @deprecated Import `useSlotPluginIds` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotPluginIds,
  /** @deprecated Import `useSlotRegistry` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotRegistry,
  /** @deprecated Import `useSlotRegistryOrNull` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  useSlotRegistryOrNull,
  /** @deprecated Import `WorkspaceActionBarSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  WorkspaceActionBarSlot,
  /** @deprecated Import `WorktreeCardSectionSlot` from `@blackbelt-technology/dashboard-plugin-runtime/host` (tests: `/test-support`). Removed after one minor release. */
  WorktreeCardSectionSlot,
} from "./host.js";
export * from "./public.js";
