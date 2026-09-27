# DOX — packages/system-one/src

System-1 adapter library. Spec: system-one-adapter, system-one-config. See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `capabilities.ts` | `estimateTokens` = (state chars + longest question chars) ÷ 4 (under-counts CJK, accepted). `fitsCapabilities(caps, state, questions)` per-request gate (context, `maxOptions`, primitives). `incompatReasons(caps, requires)` per-consumer UI filter. `null` capability = unknown = never excludes. Type-only imports → browser-safe (`./capabilities` export). |
| `catalog.ts` | `CATALOG` built-in models: jev-1.13.0 (32k/255/en-first/hosted, `keyRef TYPESAFE_API_KEY`, $0.042/MTok), von-1.2 (8192), laya (512), laya-multilingual (1024, multi), laya-typed-decisions (1024), kev. `DEFAULT_CHECKPOINT` {von: von-1.2, laya: laya}. `backendModel`, `catalogEntry` (exact model match), `effectiveCapabilities` (catalog overlaid by config; explicit null = unknown), `effectiveKeyRef`. |
| `config.ts` | `loadConfig({project?})`: user `~/.pi/agent/system-one.json` + project `<cwd>/.pi/system-one.json` ONLY when `project.trusted === true`. `version: 1` required per layer; invalid/unknown → layer absent + one `[system-one]` warning. Project may set only `presets.<activePreset>.consumers.<id>.chain`, restricted to user-defined on-machine backends (llm counts off-machine); every other key ignored + warned. mtime+size cache. `normalizeUser` (`mapOwn`), `normBackend` (per-kind `normHttp`/`normManaged`/`normLlm`; drops key-like `apiKey`/`key`/`token` with warning; http needs http/https url). `onReset`/`_resetForTests`. Null-prototype maps (D12). |
| `decision-log.ts` | `logDecision` → one JSONL line per predict at `decisions/<UTC day>.<pid>.jsonl` (0600): consumerId, attempts, model, mode, answers (distributions), `stateSha256`. Never state/instructions/keys. Failures swallowed. `pruneDecisionLogs(now)` deletes files > 30 whole UTC days old (day from filename, mtime fallback); runs on load. |
| `egress.ts` | `isLoopbackHost` (`localhost`, `127.0.0.0/8`, `[::1]` only; `localhost.` + IPv4-mapped IPv6 = off-machine). `parseBackendUrl` (http/https only, else null). `isOffMachine(b, llm?)`: managed → on; http → by URL host; llm → on only when `isLocal(role) === true` (throw/missing caller → off). Design D6. |
| `fs-util.ts` | `atomicWrite0600(path, text)`: temp file 0600 + `renameSync`; temp removed on failure, target untouched. |
| `index.ts` | Public barrel: types, `predict`, `resolveChain`, config/catalog/capabilities/egress/keys/registry/paths helpers, `atomicWrite0600`, `safeParse`. |
| `keys.ts` | Key sources: env var named by `keyRef` → `auth.json` (0600, atomic). `resolveKey` (http backend only), `keyStatus` → `{set, source: env\|file\|null}` (never the key), `writeKey` (empty value removes), `isValidKeyRef` `^[A-Z_][A-Z0-9_]{0,127}$`. Design D7. |
| `paths.ts` | Per-call `homedir()` paths: `userConfigPath`, `projectConfigPath`, `stateDir`, `consumersDir`, `decisionsDir`, `authPath`. |
| `predict.ts` | `predict(req)`: validate consumer id `^[a-z0-9][a-z0-9:._-]{0,127}$` (bad → error, no request) → register → load config → chain (`onlyBackend` \| override > preset > []) → per entry: llm w/o caller `no-backend` → egress `off-machine` → `capability` → managed w/o port `no-backend` → call → validate. First success wins; no retry; caller abort → `timeout`. `mode` enforce only for exact `<backend>::<consumer>` record with matching model. Timeouts 2 s http / 15 s llm. `resolveChain` drops undefined ids (one warning). Internals: `gate`, `call`, `attempt`, `calibrationFor`, `chainFor`. D4: reports, never decides. |
| `registry.ts` | `CONSUMER_ID`. `registerConsumer`: `consumers/<sha256(id)>.json` (0600, atomic) once per id per process per unchanged declaration; failures swallowed. `consumerFile(id)`. Design D8. |
| `safe-json.ts` | `safeParse(text, onDropped)`: null-prototype objects, drops `__proto__`/`constructor`/`prototype` at any depth (reported by path). `isObj`, `own`. Design D12. |
| `types.ts` | Contract types: `Question` (choice/score/noul), `Answer`, `ConsumerDeclaration`, `PredictRequest` (`llmCaller`, `onlyBackend`, `project`), `PredictResult` (+ `attempts`), `LlmCaller`, `Backend` (http/managed/llm), `Preset`, `CalibrationRecord`, `SystemOneConfig`. |
| `validate.ts` | `normalizeAnswers(questions, raw)`: every question answered and constrained (choice key ∈ criteria, score ∈ [0, levels-1], noul ∈ [0,1], probabilities ∈ [0,1] over declared keys); else null → attempt `error`. Missing probabilities → picked option 1.0. Per type: `normChoice`/`normScore`/noul. |
| `warn.ts` | `warnOnce(msg)` → `console.warn("[system-one] …")` deduped per process. |
| `__tests__/config.test.ts` | L1 E12–E16 (2.1–2.5): layering matrix, project limits, no hosted retarget, prototype pollution, shape handling. |
| `__tests__/config-reread.test.ts` | L1 P2 (3.20): 1,000 predicts read the config once (counted `node:fs` wrapper); an mtime touch adds exactly one read. |
| `__tests__/decision-log.test.ts` | L1 E11, X8, X9 (4.1–4.3): no SECRET/INSTR marker, 0600, read-only dirs tolerated, 29/30 kept · 31 deleted. |
| `__tests__/fake-backend.test.ts` | L1 self-test of the fake backend helper (1.3). |
| `__tests__/helpers/config.ts` | `freshState()` (HOME is per FILE → clear config + state dir + caches per test), `writeUserConfig`, `chainConfig`. |
| `__tests__/helpers/fake-backend.ts` | `startFakeBackend()` loopback `/v1/systemone` fake (answer/delay/destroy/redirect/status, connection counter), `autoAnswer`, `interceptOffMachine()` (wraps `globalThis.fetch`; records non-loopback targets, never sends). Reused by plugin tests. |
| `__tests__/keys.test.ts` | L1 E17–E18 (2.6–2.7): env > file > none × keyRef explicit/catalog/none; 0600; atomic write with failing rename keeps K1, no temp. |
| `__tests__/overhead.test.ts` | L1 P1 (3.19): 1,000 calls, adapter overhead p95 ≤ 5 ms. |
| `__tests__/predict.test.ts` | L1 E1–E9, X1, X3–X7 (3.1–3.9, 3.11, 3.13–3.17). |
| `__tests__/registry-llm.test.ts` | L1 E10, E7, X2 (3.10, 3.7, 3.12): self-registration files, llm egress matrix, 15 s timeout with a caller ignoring its signal (fake timers). |
