# DOX — packages/shared/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/codeql-workflow-contract.test.ts` | Static contract for `.github/workflows/codeql.yml` (#E1): matrix `actions`/`javascript-typescript`/`python`,… → see `__tests__/codeql-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/config-pairing.test.ts` | #E1: `pairing.acceptLanRequests` loader — default false, non-boolean → false. See change: add-lan-knock-pairing. |
| `__tests__/client-build-deps-runtime.test.ts` | Repo-lint (#E6): client `package.json` declares `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,… → see `__tests__/client-build-deps-runtime.test.ts.AGENTS.md` |
| `__tests__/ci-vitest-report-artifact.test.ts` | Repo-lint: every vitest job in `ci.yml` uploads its own JSON report `if: always()`. → see `__tests__/ci-vitest-report-artifact.test.ts.AGENTS.md` |
| `__tests__/ci-affected-selection-contract.test.ts` | Parallel `ci.yml` contract (E30). → see `__tests__/ci-affected-selection-contract.test.ts.AGENTS.md` |
| `__tests__/client-no-node-subjects-import.test.ts` | Import guard: client never imports Node-only `forbidden-subjects`/`canonical-subject`. See change: ask-agent-file-access-in-chat. |
| `__tests__/config-pi-trust-mirror.test.ts` | #E21: `piTrustMirror` loader defaults + partial merge. See change: mirror-dashboard-trust-to-pi. |
| `__tests__/nightly-tests-workflow-contract.test.ts` | Repo-lint for `nightly-tests.yml` (E31). → see `__tests__/nightly-tests-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/pi-trust-mirror.test.ts` | #E1 #E2 #E6 #E7 #E8 #E9: piTrustKey golden vs installed pi store, deny rules, source/choice filter, decidePiTrust table. See change: mirror-dashboard-trust-to-pi. |
| `__tests__/project-root.test.ts` | `hasProjectRootMarker`: `.git` dir/file + `.pi` true; plain/missing false. See change: add-access-provisioning. |
| `__tests__/tool-path-resolve.test.ts` | #E24: containment (sibling prefix, equality, probe-free exact hit, fold only when probe says, win32), D6 dangling-link following on a real temp tree (`sub/../x` from real target), loop throws, legacy env literal unchanged. See change: add-path-containment-guard-extension. |
| `__tests__/ship-it-codeql-wiring.test.ts` | Static wiring guard (#E30): `ship-it` step 4.4 lists the CodeQL baseline-diff check; step 4.4b sits between… → see `__tests__/ship-it-codeql-wiring.test.ts.AGENTS.md` |
| `__tests__/test-collection-completeness.test.ts` | Every test-bearing `packages/*` collected by root projects or excluded with a reason (E28). → see `__tests__/test-collection-completeness.test.ts.AGENTS.md` |
| `__tests__/e2e-browser-workflow-contract.test.ts` | Repo-lint contract for `.github/workflows/ci-e2e-browser.yml` (change: stabilize-browser-e2e, #433 part 2). → see `__tests__/e2e-browser-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/e2e-fixme-guard.test.ts` | Repo-lint: conditional `test.fixme` must link an issue; file-level conditional `test.skip` must link an issue or name a spec-running CI job. → see `__tests__/e2e-fixme-guard.test.ts.AGENTS.md` |
| `__tests__/workflow-jobs.ts` | Test helper: line-based GitHub Actions job slicing. Exports `jobIds(yaml)` (2-space keys under column-0… → see `__tests__/workflow-jobs.ts.AGENTS.md` |
| `__tests__/explore-mockup-adoption-wiring.test.ts` | Repo-lint (test-plan W1–W9): `openspec/config.yaml` has exactly `rules.proposal`+`rules.tasks` (one string… → see `__tests__/explore-mockup-adoption-wiring.test.ts.AGENTS.md` |
| `__tests__/ci-publish-imports-workflow-contract.test.ts` | ci.yml post-build publish-imports run contract (X3). → see `__tests__/ci-publish-imports-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/knip-workflow-contract.test.ts` | CI placement contract for the dead-code oracle (test-plan #X1-#X3). → see `__tests__/knip-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/nightly-workflow-contract.test.ts` | Repo-lint safety contract for the nightly (change: add-nightly-verdaccio-build). → see `__tests__/nightly-workflow-contract.test.ts.AGENTS.md` |
| `__tests__/real-process-project-guard.test.ts` | Repo-lint for the real-process vitest phase. → see `__tests__/real-process-project-guard.test.ts.AGENTS.md` |
| `__tests__/node-cap-single-source.test.ts` | Repo-lint (#E5): engines-cap arithmetic lives only in `node-version.ts`. → see `__tests__/node-cap-single-source.test.ts.AGENTS.md` |
| `__tests__/smoke-node-matrix.test.ts` | Repo-lint (#E8): `_smoke.yml` `standalone-install-smoke-linux` matrix majors equal the SUPPORTED set… → see `__tests__/smoke-node-matrix.test.ts.AGENTS.md` |
| `__tests__/site-deploy-workflow-contract.test.ts` | Static contracts: deploy-site.yml + sync-release-version.yml triggers/push targets, shell composition, CNAME… → see `__tests__/site-deploy-workflow-contract.test.ts.AGENTS.md`
| `__tests__/site-design-tokens-contract.test.ts` | #E11: `site/{index,404}.html` declare 13 product tokens in `:root` + `[data-theme="light"]`; no `--pi-`/`rgb(var(`/`root.dark`. See change: fix-ci-pipeline-followups. |
| `__tests__/site-seo-contract.test.ts` | E1–E23 `site/` SEO pins → see `__tests__/site-seo-contract.test.ts.AGENTS.md` |
| `__tests__/spec-collateral-wiring.test.ts` | Repo-lint for spec-collateral wiring (X6, W1–W5). → see `__tests__/spec-collateral-wiring.test.ts.AGENTS.md` |
| `__tests__/state-replay.test.ts` | L1 for the persisted `compaction` → `session_compact` replay arm (change: replay-compaction-boundary, E1–E7 +… → see `__tests__/state-replay.test.ts.AGENTS.md` |
| `__tests__/workflow-token-cache-contract.test.ts` | Repo-lint: workflow token permissions + no release-job cache. → see `__tests__/workflow-token-cache-contract.test.ts.AGENTS.md` |
| `__tests__/config-keeper-log.test.ts` | keeperLog parse boundaries (test-plan #E7): valid values pass; 0/−1/non-numeric/absent coerce to defaults; `capturePiOutput` unaffected. See change: fix-runaway-keeper-log-growth. |
| `anthropic-messages-source.ts` | `ANTHROPIC_MESSAGES_SOURCE` — install source of the `pi-anthropic-messages` peer, own module so the client cold-landing peer probe reads it without pulling `recommended-extensions.ts` (all descriptions) into the gzipped index chunk; `RECOMMENDED_EXTENSIONS` entry references it. |
| `archive-types.ts` | `ArchiveEntry` interface — OpenSpec archive dir row (name, date, done artifacts). Shared server↔client. |
| `bind-reachability.ts` | Bind-vs-trust reachability: the ONE predicate + well-known-range table, imported by both client and server so… → see `bind-reachability.ts.AGENTS.md` |
| `boot-state.ts` | Exit-intent vocabulary for the server boot record. Exports `ExitIntent`… → see `boot-state.ts.AGENTS.md` |
| `bridge-register.ts` | Shared bridge registration: `findBundledExtension(baseDir)` + `registerBridgeExtension(path)`;… → see `bridge-register.ts.AGENTS.md` |
| `browser-protocol.ts` | Server↔Browser WebSocket message contracts: `ServerToBrowserMessage`/`BrowserToServerMessage` unions + payload types. → see `browser-protocol.ts.AGENTS.md` |
| `canonical-subject.ts` | Access-subject canonical form + containment (moved from server). → see `canonical-subject.ts.AGENTS.md` |
| `card-sections.ts` | Session-card section visibility model: `CARD_SECTION_IDS`, `CardSectionPrefs`, per-plugin block ids, focus-mode profile, `resolveCardSectionVisible`. → see `card-sections.ts.AGENTS.md` |
| `changelog-types.ts` | `ChangelogBullet` / `Release` / `Response` types for parsed CHANGELOG.md responses. See change: pi-update-whats-new-panel. |
| `config.ts` | Dashboard config loader: `loadConfig()`/`ensureConfig()` read `~/.pi/dashboard/config.json` via `CONFIG_FILE`; owns startup budgets + shared ports. → see `config.ts.AGENTS.md` |
| `credential-detect.ts` | Detects configured LLM-provider credential. `hasAnyProviderCredential(homeDir?)` OR-merges… → see `credential-detect.ts.AGENTS.md` |
| `cwd-guard.ts` | Plugin cwd guard: `isAllowedCwd`, async `admitCwd`. → see `cwd-guard.ts.AGENTS.md` |
| `dashboard-paths.ts` | Single-source path helpers for dashboard runtime dirs. `getDashboardConfigDir` → `~/.pi/dashboard/`. → see `dashboard-paths.ts.AGENTS.md` |
| `dashboard-starter.ts` | Identifies dashboard launcher. `DashboardStarter` = `Bridge` | `Standalone` | `Electron`. → see `dashboard-starter.ts.AGENTS.md` `starterFromHealth(body)` maps a `/api/health` body to `DashboardStarter\|undefined`: static `launchSource` first (never `launchSourceEffective`), legacy `starter` fallback. See change: fix-cli-control-electron-server. |
| `diff-types.ts` | Session file-diff API types. `EditOperation`, `FileChangeEvent`, `FileDiffEntry`, `SessionDiffResponse`… → see `diff-types.ts.AGENTS.md` |
| `custom-event-groups.ts` | Browser-safe types + shipped defaults for custom chat row groups. → see `custom-event-groups.ts.AGENTS.md` |
| `custom-event-groups-store.ts` | Node-side store for `~/.pi/dashboard/custom-event-groups.json`. → see `custom-event-groups-store.ts.AGENTS.md` |
| `display-name.ts` | Display-name sanitising: `truncateUtf8`, `stripInvisible`, `sanitizeDisplayName(raw, fallback, maxBytes=64)` (control/bidi/zero-width stripped). See change: add-electron-server-windows. |
| `display-prefs.ts` | `DisplayPrefs` interface gates chat-view chrome (thinking, tool calls per kind, turn separators, debug… → see `display-prefs.ts.AGENTS.md` |
| `doctor-core.ts` | Pure detection core. Types `DoctorCheck` / `DoctorReport` / `DoctorSection` (6:… → see… → see `doctor-core.ts.AGENTS.md` |
| `electron-restart.ts` | `ELECTRON_RESTART_EXIT_CODE` (75) + `restartsViaElectron(env)` (Electron starter +… → see `electron-restart.ts.AGENTS.md` |
| `enabled-models-match.ts` | `enabledModels` matching shared by the bridge extension and the pi settings scope editor: `stripThinkingLevel`, `matchesPattern(model,pattern)` (minimatch nocase on `provider/id` and bare `id`), `modelInScope(model,entries)`. Needs `minimatch` (dependency). See changes: pi-settings-full-coverage, update-pi-core-1-3-adopt-apis (`sessionShareDestination` enum). |
| `event-forward-declaration.ts` | Contract for plugin forward declarations. Exports `REGISTER_EVENT_FORWARD_CHANNEL`, `BRIDGE_READY_CHANNEL`,… → see `event-forward-declaration.ts.AGENTS.md` |
| `forbidden-subjects.ts` | Never-grantable subjects (moved from server). → see `forbidden-subjects.ts.AGENTS.md` |
| `instance-directory.ts` | `listLocalInstances()` / `resolveInstanceRef()` / `formatInstanceLine()` — enumerates `gateway-*.sock` under… → see `instance-directory.ts.AGENTS.md` |
| `launcher-origin.ts` | Loopback-host-on-configured-port predicate `isLauncherOrigin`. → see `launcher-origin.ts.AGENTS.md` |
| `live-server.ts` | Pure browser-safe live-server SSRF boundary. `validateLiveTarget({host,port,label})` — loopback-only… → see `live-server.ts.AGENTS.md` |
| `file-kind.ts` | Pure browser-safe viewer classifier. `fileKind(absPath, sniff?)` → `{ kind, mimeType, viewer, editable }`. → see `file-kind.ts.AGENTS.md` |
| `git-worktree-helpers.ts` | Pure worktree helpers shared by server + client. `slugifyBranch(branch)` → fs-safe slug; `localNameOf(ref)`… → see `git-worktree-helpers.ts.AGENTS.md` |
| `grammar-types.ts` | Wire contract for composer grammar/spell check (client↔server).… → see `grammar-types.ts.AGENTS.md` |
| `heap-flags.ts` | V8 heap flag plumbing (pure strings): `maxOldSpaceFlag`, `buildSessionHeapArgs`, `HEAP_FLAG_MARKER_ENV`. → see `heap-flags.ts.AGENTS.md` |
| `heap-limits.ts` | BROWSER-SAFE V8 heap types, defaults, subagent + server-heap/store-budget coupling guards… → see `heap-limits.ts.AGENTS.md` |
| `host-admission.ts` | Browser-safe host-admission primitives shared by the server gate and the Settings editor.… → see `host-admission.ts.AGENTS.md` |
| `host-port.ts` | Dependency-free `formatHostPort(host,port)` (brackets IPv6) + `normalizeHostKey` (lowercase, strip brackets +… → see `host-port.ts.AGENTS.md` |
| `host-pressure.ts` | Host-pressure thresholds, ONE source of truth. Exports `HOST_PRESSURE_DEGRADED_MS` (35_000),… → see `host-pressure.ts.AGENTS.md` |
| `index.ts` | Barrel re-exports for cumbersome symbols. Re-exports `doctor-core.js`, `node-version.js`, `ViewTarget` type,… → see `index.ts.AGENTS.md` |
| `launch-source-types.ts` | `LaunchSource` discriminated union for Electron server layout. → see `launch-source-types.ts.AGENTS.md` |
| `legacy-managed-dir.ts` | `detectLegacyManagedDir({ homedir? })`. Returns `{present:false}` or `{present:true, path, pkgCount,… → see `legacy-managed-dir.ts.AGENTS.md` |
| `local-credential-proof.ts` | Pure local credential proof primitive: `mintProof`/`parseProof`/`canonicalBinding`/counter-proof/`localDialHost`. → see `local-credential-proof.ts.AGENTS.md` |
| `md-table-cell.ts` | GFM cell escape. → see `md-table-cell.ts.AGENTS.md` |
| `memory-limits.ts` | BROWSER-SAFE memory-limit types + defaults: `MemoryLimitsConfig`, `MIN_REPLAY_WINDOW` (100), `DEFAULT_MEMORY_L. → see `memory-limits.ts.AGENTS.md` |
| `managed-paths.ts` | Single source of truth for managed install dir `~/.pi-dashboard/`. → see `managed-paths.ts.AGENTS.md` |
| `model-catalogue.ts` | `catalogueRowToModelInfo(row)` maps a `GET /api/models` row to `ModelInfo` (no `metadataSource`); `mergeModelOptions(catalogue, sessionModels)` dedupes by `provider/id`, session row wins. |
| `model-id.ts` | First-slash model-id parser. `parseModelId(label)` → `{provider, modelId}`: provider = before first `/`,… → see `model-id.ts.AGENTS.md` |
| `mdns-discovery.ts` | mDNS `_pi-dashboard._tcp` advertise + discover. Identity-derived names `pi-dashboard-<id12>-<port>`, TXT… → see `mdns-discovery.ts.AGENTS.md` |
| `models-json-reader.ts` | ONE shared pure reader for user-authored `~/.pi/agent/models.json`, consumed by BOTH registry paths… → see `models-json-reader.ts.AGENTS.md` |
| `node-version.ts` | Single source of truth for Node-version predicates. `isAffectedNode(version)` flags nodejs/node#58515… → see `node-version.ts.AGENTS.md` |
| `notify.ts` | `normalizeNotifyLevel(level)` — maps an unrecognized notify level to `"info"`. → see `notify.ts.AGENTS.md` |
| `openspec-activity-detector.ts` | Detects OpenSpec activity from tool-execution events. `detectOpenSpecActivity(toolName, args, cwd)` — `cwd` REQUIRED, from server state — returns `{… → see `openspec-activity-detector.ts.AGENTS.md` |
| `openspec-design-evidence.ts` | Local-evidence override for OpenSpec `design` artifact. `evaluateLocalDesignSatisfaction(changeDir, probe)`… → see `openspec-design-evidence.ts.AGENTS.md` |
| `openspec-poller.ts` | Aggregates `openspec list`+`status` into `OpenSpecData`. `pollOpenSpec(cwd)` sync (bridge),… → see… → see `openspec-poller.ts.AGENTS.md` |
| `openspec-specs-evidence.ts` | Local-evidence override for OpenSpec `specs` artifact. `evaluateLocalSpecsSatisfaction(changeDir, probe)` =… → see `openspec-specs-evidence.ts.AGENTS.md` |
| `openspec-status-all.ts` | Pure `status --all` helpers (no fs/spawn; worker-safe). `parseJsonOrNull`, `classifyStatusAll(raw)` → `unsupported`/`failed`/`ok{root,entries}` (unsupported checked first; failed = no JSON / top-level error / `root:null` / `root.source==='implicit'`), `sanitizeChangeError`, `entryError` (`unknown-entry`), `countTasksFromContent` (verbatim copy of OpenSpec 1.14.3 `TASK_LINE_PATTERN`: any CommonMark list marker incl. `+`/`1.`/`1)`, one-token checkbox so `[~]`/`[]` count as open, link bullets excluded; re-copy on every CLI bump, the `status --all` parity suite is the oracle; see change: refresh-electron-bundled-components), `selectTrackedArtifact`, `canonicalArtifactOrder`, `createStatusAllSupportCache` (verdict per resolved CLI `version`; null version = process-cached, retried on force), `mapCliPath`/`computeTrackedExtras`/`matchesOutputPattern`, `mapLimit`. See change: use-openspec-status-all. |
| `operate-required.ts` | Wire types for the `operate_required` 403: `OperateRemedy`, `OPERATE_REMEDY_ORDER`, `OperateRequiredReason`, `OperateRequiredBody` (5 keys, no posture). `OperateRemedy` gains `request-access`; order `use-host, re-pair, request-access, sign-in`. See change: surface-operate-required-remedy, add-request-access-remedy. |
| `pairing-knock-client.ts` | Native LAN-knock client: `ProveFn`, `proveExpected`, `sendKnock`, `knockServerWith`, `knockRequestBody`. See change: add-electron-server-windows (D2). |
| `pairing-knock.ts` | Knock vocabulary shared by server + client: `KNOCK_REFUSALS`, `KnockRefusal`, `PairingProvenance`,… → see `pairing-knock.ts.AGENTS.md` |
| `pairing-refusal.ts` | Pairing-approval 401 wire types (`PairingRefusalBody`, `PAIRING_REMEDY_ORDER`). → see `pairing-refusal.ts.AGENTS.md` |
| `path-containment-guard-name.ts` | `PATH_CONTAINMENT_GUARD_EXT_NAME = "path-containment-guard"`: single spelling for the guard's `extensionConfig` name / env namespace, shared by the guard package and server `buildSpawnEnv` (server never imports the guard). See change: add-path-containment-guard-extension. |
| `path-containment.ts` | Boundary-correct `isPathInside(parent, child, platform?)` (sibling prefix `/repo-other` is NOT inside… → see `path-containment.ts.AGENTS.md` |
| `pi-package-resolver.ts` | Walks `~/.pi/agent/settings.json#packages[]` + per-workspace `<cwd>/.pi/settings.json`. → see `pi-package-resolver.ts.AGENTS.md` |
| `pi-settings-keys.ts` | `PI_MANAGED_SETTINGS_KEYS` (`defaultProvider`,`defaultModel`,`defaultThinkingLevel`) — pi `settings.json`… → see `pi-settings-keys.ts.AGENTS.md` |
| `pi-settings-schema.ts` | Typed key schema of pi's global `settings.json` (50 keys: bool/enum/mixed/int/string/`enabledModels`): `PI_SETTINGS_SCHEMA` (`key`,`kind`,`options`,`min`,`max`,`def`,`category`,`label`,`hint`), `PI_SETTING_CATEGORIES`, `PI_SETTINGS_BLOCKS`, `checkPiSettingValue`, `getPiSettingDef`. Drives server patch validation AND client rows. Excludes `PI_MANAGED_SETTINGS_KEYS`. Parity test reads upstream pi docs/settings.md. See change: pi-settings-full-coverage. |
| `pi-trust-mirror-snapshot.ts` | Snapshot + trust-store readers shared by bridge and server. → see `pi-trust-mirror-snapshot.ts.AGENTS.md` |
| `pi-trust-mirror-types.ts` | Browser-safe types: `MirrorSourceKind`, `MirrorIgnoreReason`, `MirrorWithheldReason`, `MIRROR_REASON_LABELS`,… → see `pi-trust-mirror-types.ts.AGENTS.md` |
| `pi-trust-mirror.ts` | Dashboard-trust → pi mirror shared core. `piTrustKey(path,{home})` = pi's trust-store key (realpath∘resolve,… → see `pi-trust-mirror.ts.AGENTS.md` |
| `plugin-bridge-register.ts` | Dual-write contract. `registerPluginBridge` writes BOTH `dashboardPluginBridges["dashboard-<id>"]` AND… → see `plugin-bridge-register.ts.AGENTS.md` |
| `project-name.ts` | Portable project-name rules + `isPortableProjectName` guard. → see `project-name.ts.AGENTS.md` |
| `project-root.ts` | `hasProjectRootMarker(dir)`: the ONE `.git`/`.pi` project-root test (`.git` dir or worktree file, or `.pi`); never throws. Used by `pi-trust-mirror-snapshot.ts` + server `pi-trust-mirror-service.ts`. Node-only. See change: add-access-provisioning. |
| `prompt-answer.ts` | `encodePromptAnswer` (moved from client) + `validateQuestionAnswer`. → see `prompt-answer.ts.AGENTS.md` |
| `protocol.ts` | Extension↔Server WebSocket protocol. `ExtensionToServerMessage` + `ServerToExtensionMessage` unions. → see `protocol.ts.AGENTS.md` `EventForwardMessage.replay?: true`; `SessionRegisterMessage.leafEntryId?` + `liveTailOpen?`. See change: fix-large-session-resume-replay. |
| `question-types.ts` | `QuestionRow`/`QuestionDetail`/`BriefStatus`/`QuestionAnswerRequest`/`QuestionsUpdateMessage`. → see `question-types.ts.AGENTS.md` |
| `recovery-timing.ts` | The two cold-start recovery windows in one module so their relation is testable. → see `recovery-timing.ts.AGENTS.md` |
| `redaction.ts` | `REDACTION_PATTERNS_V1`, `REDACTION_VERSION`, `redactSecrets`. → see `redaction.ts.AGENTS.md` |
| `recommended-extensions.ts` | Curated manifest of recommended pi extensions. `RecommendedExtension` (id, source, displayName, status,…). → see `recommended-extensions.ts.AGENTS.md` |
| `rest-api.ts` | REST endpoint request/response types. Sessions, events, spawn, file read/write (`FileWriteRequest` mtime… →… → see `rest-api.ts.AGENTS.md` |
| `role-config-disk.ts` | Node-only `readRoleConfigFromDisk(home?)` + `providersJsonPath`; total — missing/garbled `providers.json` →… → see `role-config-disk.ts.AGENTS.md` |
| `role-name-validation.ts` | Shared role-name trust boundary. `isValidRoleName(name, existing) → {ok, reason?}`: non-empty after trim;… → see `role-name-validation.ts.AGENTS.md` |
| `role-schema.ts` | Pure, `node:fs`-free role-schema core shared by every role read surface (bridge `role-manager.ts`, roles-plugin `/api/roles` route, roles-plugin client). → see `role-schema.ts.AGENTS.md` |
| `rendezvous.ts` | HOME-derived rendezvous record reader; resolves the local endpoint + instance identity without discovery. → see `rendezvous.ts.AGENTS.md` |
| `semaphore.ts` | Tiny FIFO throttling semaphore. `createSemaphore(max)` → `Semaphore` with `run(fn)` (queue when at cap,… → see `semaphore.ts.AGENTS.md` |
| `server-identity.ts` | Identity-verified dashboard detection over GET /api/health. → see `server-identity.ts.AGENTS.md` |
| `server-launcher.ts` | `launchDashboardServer` — single shared spawn primitive (selected TS loader — native default, jiti opt-in —… → see `server-launcher.ts.AGENTS.md` |
| `server-pinning.ts` | Client-side D8 pinning of the server Ed25519 identity.… → see `server-pinning.ts.AGENTS.md` |
| `session-group-by.ts` | Group-by vocabulary + guards (`GroupByMode`, `LaneId`, `laneCollapseKey`). → see `session-group-by.ts.AGENTS.md` |
| `session-group-path.ts` | Hoisted `inferPlatform`/`pathKey`/`resolveSessionGroupPath` from client session-grouping.ts. → see `session-group-path.ts.AGENTS.md` |
| `session-meta.ts` | Per-session sidecar `.meta.json` schema + IO. Exports `SessionMeta`, `metaPath`, `readSessionMeta`,… → see… → see `session-meta.ts.AGENTS.md` |
| `session-name.ts` | `sanitizeSessionName`. See change: investigate-auto-name-provenance-relabel. |
| `skill-block-parser.ts` | Single source of truth for pi's `<skill name location>…</skill>` envelope. → see `skill-block-parser.ts.AGENTS.md` |
| `source-matching.ts` | `sourcesMatch` cross-kind matcher. Adds `npm ↔ raw` branch: npm-declared package installed from local path… → see `source-matching.ts.AGENTS.md` |
| `session-meta.ts` | `SessionMeta` sidecar shape + read/write/merge. Adds `originDeviceId?` — origin gates FILESYSTEM READS, so it… → see `session-meta.ts.AGENTS.md` |
| `state-replay.ts` | Synthesizes dashboard `event_forward` messages from persisted pi session entries for post-reconnect chat… → see `state-replay.ts.AGENTS.md` |
| `stats-extractor.ts` | Extracts `StatsData` (tokensIn/out, cost, turnUsage, optional contextUsage) from a `turn_end` event's… → see `stats-extractor.ts.AGENTS.md` |
| `terminal-safe.ts` | `INVISIBLE_OR_SEPARATOR` + `terminalSafe`. → see `terminal-safe.ts.AGENTS.md` |
| `tls-status.ts` | Browser-safe wire types of `/api/health.tls`: `TlsGate`, `TlsSourceStatus`, `TlsCertStatus` (held, notAfter ms, stage, lastError ≤500, nextAttemptAt), `TlsStatusBasic` (`enabled`,`bound` — everyone) / `TlsStatusDetail` (port, host, bindError, gates, sources, certs — authed or genuinely-local), `hasTlsDetail()`. Server builds them, Gateway "Built-in HTTPS" reads them. See change: add-tailscale-cert-tls. |
| `tool-path-resolve.ts` | Shared pi-parity path resolver: `resolveToolPath`, `resolveReadTarget`, `canonicalizeTarget` (realpath nearest ancestor; follows DANGLING symlinks component-wise from the link's real parent, 40-hop bound, throws on loop), `isWithinRoot`/`isPathWithinRoots` (component-wise, exact-first, volume-probe fold). Injectable `ResolveEnv` (`isSymlink?`/`readlink?` optional → legacy literals unchanged). Used by extension path-gate + `path-containment-guard`. See change: add-path-containment-guard-extension. |
| `tunnel-concurrency.ts` | Resolves WHICH providers run and in which mode.… → see `tunnel-concurrency.ts.AGENTS.md` |
| `tunnel-provider.ts` | Tunnel ("Gateway") provider abstraction types. Exports `TunnelProvider` interface (`id`, `kind`… → see `tunnel-provider.ts.AGENTS.md` |
| `transcript-request-guard.ts` | Pure `decideTranscriptRequest()` — session id only, path-bearing field refused. → see `transcript-request-guard.ts.AGENTS.md` |
| `__tests__/transcript-request-guard.test.ts` | L1 for the guard (#E13, #E14): own-session allow, foreign-session refusal, every path-bearing field refused… → see `__tests__/transcript-request-guard.test.ts.AGENTS.md` |
| `__tests__/bundle-runtime-contract.test.ts` | Bundle contract: root `dependencies` = `pluginRuntimeDeps` only; build-installer watch list derived + plugin gate after rebundle (E14, E24). See change: bundle-plugin-third-party-deps. |
| `__tests__/bundle-watch-paths.test.ts` | `bundle-watch-paths.mjs` output covers plugins, workspaces, client, bundler (E23). See change: bundle-plugin-third-party-deps. |
| `__tests__/bundled-plugins-complete.test.ts` | bundledPlugins completeness; first-party deps are workspaces; third-party union conflict-free (E13). See change: bundle-plugin-third-party-deps. |
| `__tests__/materialize-plugins-deps.test.ts` | `collectPluginRuntimeDeps` (E1–E8) + `findUnresolvedPluginDeps` (E9–E12). See change: bundle-plugin-third-party-deps. |
| `terminal-types.ts` | Terminal emulator shared types. Exports `TerminalSession` (id, cwd, shell, status, title, `ephemeral` flag for inline cards) and `TerminalControlMessage` (resize | title) control frame union. |
| `types.ts` | Core dashboard shared type surface. Exports `DashboardSession`, `DashboardEvent`, `FlowInfo`, `CommandInfo`,…… → see `types.ts.AGENTS.md` |
| `vault-delivery.ts` | Vault delivery constants shared by hub + bridge (feature flag, marker env, grace clamp, env-name rule). → see `vault-delivery.ts.AGENTS.md` |
| `vault-origin.ts` | Pure `normalizeOrigin(raw)`: SSH / SCP / HTTPS spellings of one repository → `host[:port]/path`; no node… → see `vault-origin.ts.AGENTS.md` |
| `vault-project-key.ts` | `resolveSessionProject`: the vault project key; re-exports `normalizeOrigin` (moved to `vault-origin.ts`). → see `vault-project-key.ts.AGENTS.md` |
| `worktree-init-hook.ts` | Pure worktree-init hook shape + hash moved from server: `normalizeHook`, `canonicalize`, `hookDefHash`,… → see `worktree-init-hook.ts.AGENTS.md` |
| `ws-message-tiers.ts` | `WS_MESSAGE_TIERS`, `wsMessageTier` (unlisted ⇒ operate), `LIVE_PREVIEW_TIER`, `TERMINAL_TIER`. WS half of the tier model. See change: add-passkey-user-auth. `provision_response: "operate"`. See change: add-access-provisioning. |
| `zrok-env.ts` | Pure `readZrokEnvironment({homedir,fs})` returning `{found, kind: v2\|v1\|null, path, env, reason}`. → see `zrok-env.ts.AGENTS.md` |
| `route-tiers.ts` | `ROUTE_TIERS`, `routeTier(method, pattern)`, `hasRouteTier`… → see `route-tiers.ts.AGENTS.md` |
| `tiers.ts` | `TIERS`, `Tier`, `isTier`, `rank`, `minTier`, `defaultTierForSource`. → see `tiers.ts.AGENTS.md` |
| `usage-totals.ts` | Pure usage summing (seed / JSONL reader / replay agree). → see `usage-totals.ts.AGENTS.md` |
