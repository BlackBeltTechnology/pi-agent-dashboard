# DOX — packages/mcp-client-plugin/src/core

Host-free logic for the `mcp-client` plugin: config writer, effective-view reader, adapter
verdict probe, worker-thread adapter port, and the `mcp-client.config` service. Imports NO React
and NO dashboard runtime — the hostless `apple-tools` installer consumes `./core` directly.
See change: extract-mcp-client-plugin.

| File | Purpose |
|------|---------|
| `adapter-verdict.ts` | Owns `ADAPTER_VERSION_FLOOR` (`2.20.0`) + the version probe. `probeAdapterVersion`, `compareSemver`, `adapterProbePaths`, `createAdapterVerdictProbe`; resolves the USER's installed adapter under `dirname(getPiGlobalConfigPath())` so `PI_CODING_AGENT_DIR` is honoured; 30s TTL cache. `AdapterVerdict.kind` = ok / absent / below-floor / unparseable (`unknown` is produced only by a consumer with no service). |
| `adapter-worker-entry.mjs` | Worker-thread entry (`worker_threads`). Loads the adapter's synchronous config loaders off the main thread so a hung loader cannot block the server. |
| `adapter-worker.ts` | `createDefaultAdapterPort` — the real `AdapterPort` over `adapter-worker-entry.mjs`. `AdapterTimeoutError` (route maps it to 504 `adapter-timeout`); `WorkerAdapterPortOptions`. Path helpers stay on the main thread (sync, no worker). |
| `config-io.ts` | `createRealConfigIO`, `writeFileAtomic` — exclusive random temp file mode 0600, fsync, rename. The ONLY place a config byte reaches disk. |
| `config-writer.ts` | Parse + write engine. `createConfigWriter`, `parseJsonc` (JSONC via `strip-json-comments`), `isValidServerName`, `validateResultingEntry`, `NotAllowedCwdError`, `TRANSPORT_FIELDS`, `ADAPTER_PACKAGE_SOURCE`. Merge-only writes: one key at a time, unknown keys preserved; refuses (never coerces) malformed-but-parseable shapes; parse-error message carries the path. |
| `effective-view.ts` | `createEffectiveViewReader` — reads the adapter's FULL layer stack through the port (never a hand-rolled discovery walk), classifies provenance (`pi-global` / `pi-folder` / `shared` / `other`) by `kind` + Pi-path equality, and REDACTs server-side every secret not defined in the requested scope's writable layer. Redaction payload: scalar → `{redacted:true}`; record → `{redacted:true, keys:[{name, secret}]}`. `isSecretKey` = `/authorization|token|key|secret/i`. Types: `LayerKind`, `ProvenanceLayer`, `EffectiveServerView`, `SettingSource`, `LayerParseError`, `EffectiveView`. |
| `index.ts` | `./core` barrel — the only entry other packages import. Re-exports the service factory, IO, adapter port, view reader, config-writer helpers, and the types. |
| `path-utils.ts` | Dotted-path helpers: `isPlainObject`, `getByName`, `setByName` (immutable). |
| `schema-validation.ts` | Ajv over the published schema. `mcpConfigSchema`, `validateServerPatch`, `validateSettingsPatch`, `validateTransportPresence`, `errorFields`. Every write path validates BEFORE IO. |
| `service.ts` | `createMcpClientConfigService` + `McpClientRuntime` + `McpClientConfigServiceDeps` — the in-process `mcp-client.config` service: `adapterVerdict`, `targetPath`, `readServerEntry`, `ensureServerEntry`, `applyServerPatch`, `setServerDisabled`, `setDirectTools`, `removeServer`, `patchSettings`, `ensureAdapterPackage`, `checkConfigFiles`. Composes writer + probe + worker port behind one injection seam. |
| `types.ts` | Shared vocabulary: `Scope`, `ConfigIO`, `ConfigRefusal`(+`ConfigRefusalCode`, closed set), `ConfigWriteResult`, `ReadResult`, `RemoveResult`, `ParseStatus`, `LoadOptions`, `AdapterVerdict`, `AdapterPort`, `McpClientConfigService`. Re-exports `ServerEntry` / `McpSettings` / `McpConfig` / `ServerProvenance` / `ConfigDiscoveryPath` from `pi-mcp-adapter`. |
