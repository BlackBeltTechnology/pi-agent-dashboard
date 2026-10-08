/**
 * mcp-client-plugin · CORE entry — pure, host-free logic over pi's built-in
 * MCP config.
 *
 * No host, pi or React imports: this entry is consumed by the dashboard server
 * AND by the hostless `apple-tools` installer CLI.
 * See change: migrate-mcp-to-pi-builtin; earlier: extract-mcp-client-plugin.
 */

export { createRealConfigIO, writeFileAtomic } from "./config-io.js";
export {
  type ConfigWriter,
  type ConfigWriterDeps,
  createConfigWriter,
  FOLDER_COPY_OMITTED,
  folderCopyOf,
  NotAllowedCwdError,
} from "./config-writer.js";
export {
  createEffectiveViewReader,
  type EffectiveViewReader,
  isSecretKey,
  redactEntry,
} from "./effective-view.js";
export { defaultLayerPaths, type LayerPaths, piAgentDir, readLayer } from "./layers.js";
export {
  createLiveStateReader,
  LIVE_STATE_CACHE_TTL_MS,
  LIVE_STATE_TIMEOUT_MS,
  type LiveStateReader,
  parseMcpListJson,
} from "./live-state.js";
export {
  ADAPTER_ONLY_KEYS,
  adapterLeftovers,
  authModeOf,
  displayExposure,
  ignoredKeys,
  isValidServerName,
  MCP_EXPOSURE_ALIASES,
  MCP_EXPOSURES,
  type McpExposure,
  mcpNamespace,
  transportOf,
  validatePiEntry,
} from "./pi-rules.js";
export { errorFields, mcpConfigSchema, type PatchValidation, validateServerEntry } from "./schema-validation.js";
export { createMcpClientConfigService, type McpClientConfigServiceDeps, type McpClientRuntime } from "./service.js";
export type {
  AuthMode,
  ConfigIO,
  ConfigRefusal,
  ConfigRefusalCode,
  ConfigWriteResult,
  EffectiveServerView,
  EffectiveView,
  InactiveReason,
  LayerStatus,
  LiveServerState,
  LiveState,
  McpClientConfigService,
  ParseStatus,
  PiMcpListRunner,
  Provenance,
  RemoveResult,
  Scope,
  ServerEntry,
  SetEnabledResult,
} from "./types.js";
