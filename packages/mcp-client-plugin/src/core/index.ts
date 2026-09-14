/**
 * mcp-client-plugin · CORE entry — pure, host-free logic.
 *
 * No host or React imports: this entry is consumed by the dashboard server AND
 * by the hostless `apple-tools` installer CLI.
 * See change: extract-mcp-client-plugin.
 */

export {
  ADAPTER_VERSION_FLOOR,
  type AdapterVerdictProbe,
  adapterProbePaths,
  compareSemver,
  createAdapterVerdictProbe,
  probeAdapterVersion,
} from "./adapter-verdict.js";
export { AdapterTimeoutError, createDefaultAdapterPort, type WorkerAdapterPortOptions } from "./adapter-worker.js";
export { createRealConfigIO, writeFileAtomic } from "./config-io.js";
export {
  ADAPTER_PACKAGE_SOURCE,
  type ConfigWriter,
  type ConfigWriterDeps,
  createConfigWriter,
  isValidServerName,
  NotAllowedCwdError,
  parseJsonc,
  TRANSPORT_FIELDS,
  validateResultingEntry,
  validateTransportPresence,
} from "./config-writer.js";
export {
  createEffectiveViewReader,
  type EffectiveServerView,
  type EffectiveView,
  type EffectiveViewReader,
  isSecretKey,
  type LayerKind,
  type ProvenanceLayer,
  type SettingSource,
} from "./effective-view.js";
export {
  errorFields,
  mcpConfigSchema,
  type PatchValidation,
  validateServerPatch,
  validateSettingsPatch,
} from "./schema-validation.js";
export { createMcpClientConfigService, type McpClientConfigServiceDeps, type McpClientRuntime } from "./service.js";
export type {
  AdapterPort,
  AdapterVerdict,
  ConfigDiscoveryPath,
  ConfigIO,
  ConfigRefusal,
  ConfigRefusalCode,
  ConfigWriteResult,
  LoadOptions,
  McpClientConfigService,
  McpConfig,
  McpSettings,
  ParseStatus,
  Scope,
  ServerEntry,
  ServerProvenance,
} from "./types.js";
