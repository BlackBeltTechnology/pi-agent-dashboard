/**
 * PUBLIC host API surface of `@blackbelt-technology/dashboard-plugin-runtime`.
 *
 * This file is the only surface behind the (Phase 5) import map and the
 * `host-api-surface.json` snapshot (`scripts/host-api-surface.mjs`). The package
 * root re-exports it. Shell internals live in `./host.ts`; test helpers in
 * `./test-support`. Removing a name here needs a `PLUGIN_HOST_API_VERSION` major
 * bump; adding one needs at least a minor bump.
 *
 * See change: decouple-plugins-from-core.
 */
export { PLUGIN_HOST_API_VERSION, satisfiesHostApi } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
export {
  ComposerDockRow,
  type ComposerDockRowProps,
} from "./ComposerDockRow.js";
export {
  openPluginTabRoute,
  pluginTabRouteHref,
} from "./editor-pane-tab.js";
export {
  type EmbeddedAppShell,
  useEmbeddedAppShell,
} from "./embedded-app-shell.js";
export {
  type FolderMenuContribution,
  type FolderMenuGroup,
  useFolderMenuItem,
  useFolderMenuRefresher,
} from "./folder-menu-contributions.js";
export {
  type FolderProjectEntry,
  folderHasProjectId,
  folderHasProjectType,
  getFolderProject,
  invalidateFolderProject,
  useFolderProject,
} from "./folder-project.js";
export {
  lazyClaim,
} from "./lazy-claim.js";
export {
  type OAuthFlowClient,
  oauthFlowClient,
} from "./oauth-flow-client.js";
export {
  sendPluginAction,
} from "./plugin-action-bridge.js";
export {
  type InteractiveUiRequestSnapshot,
  type PluginLogger,
  type PluginRouter,
  type SubagentStateSnapshot,
  useAllSessions,
  useCurrentPluginId,
  useLanguage,
  usePluginConfig,
  usePluginConfigOf,
  usePluginLogger,
  usePluginMessage,
  usePluginRouter,
  usePluginSend,
  usePluginSocket,
  useSessionData,
  useSessionEvents,
  useSessionInteractiveRequests,
  useSessionState,
  useSessionSubagents,
  useShellConnectionStatus,
  useT,
} from "./plugin-context.js";
export {
  registerPromptComponent,
} from "./prompt-component-registry.js";
export {
  RoleRef,
  type RoleRefLabels,
  type RoleRefProps,
} from "./RoleRef.js";
export {
  type SlotAccent,
  SlotPill,
  type SlotPillProps,
  type SlotSurface,
} from "./SlotPill.js";
export {
  assignLocation,
  classifyNavigationTarget,
  type OpenUrlOptions,
  openExternalUrl,
  SafeLink,
  type SafeLinkProps,
  type SafeNavigation,
  type SafeNavigationHostHooks,
  setLinkBlockedNoticeText,
  showLinkBlockedNotice,
  useSafeNavigation,
} from "./safe-navigation.js";
export {
  copyText,
} from "./secure-context.js";
export {
  getSessionData,
} from "./session-data-store.js";
export type {
  SessionEventReducerSlice,
  ToolRowFinalizer,
  ToolRowFinalizerOpts,
} from "./session-event-reducers.js";
export {
  getSessionEvents,
} from "./session-events-store.js";
export {
  type SettingsDraftSource,
  useSettingsDraftSource,
} from "./settings-draft-context.js";
export {
  type FieldContract,
  type FieldControlProps,
  FieldShell,
  NumberField,
  SelectField,
  SettingsActionError,
  SettingsCopyButton,
  SettingsFacts,
  type SettingsFieldState,
  type SettingsFieldTestIds,
  SettingsGroup,
  SettingsItem,
  SettingsNotice,
  type SettingsNoticeTone,
  type SettingsRemedy,
  SettingsStatusPill,
  type SettingsStatusTone,
  SettingsTable,
  type SettingsTableRow,
  TextAreaField,
  TextField,
  ToggleField,
} from "./settings-fields.js";
export {
  bumpSlotClaimsVersion,
} from "./slot-claims-invalidation.js";
export {
  AutomationActionEditorSlot,
  ComposerContextGroup,
  useHasAutomationActionEditor,
} from "./slot-consumers.js";
export {
  UiPrimitiveProvider,
  type UiPrimitiveProviderProps,
  useUiPrimitive,
  useUiPrimitiveOrNull,
} from "./ui-primitive-context.js";
export {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  type UiPrimitiveRegistry,
} from "./ui-primitive-registry.js";
