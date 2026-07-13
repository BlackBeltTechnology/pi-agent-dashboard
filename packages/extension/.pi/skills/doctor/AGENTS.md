# DOX — packages/extension/.pi/skills/doctor

Modular doctor skill. Thin router `SKILL.md` + N self-contained capability MDs
read on demand + shared `_lib` check primitives. Router derives symptom map +
sweep DAG from module front-matter; adding a module MD auto-registers it.
See change: add-modular-doctor-skill.

| File | Purpose |
|------|---------|
| `SKILL.md` | Thin router. NO capability knowledge. Routes symptom→module, runs named module, or full sweep (env→pi→peers→plugins→build→runtime) with lower-layer short-circuit. Documents two-tier self-update + `--regenerate`. |
| `_lib/index.ts` | Barrel re-exporting all `_lib` primitives. |
| `_lib/front-matter.ts` | Parses module front-matter (`name`/`scope`/`symptoms`/`depends-on`/`derives-from`). `parseFrontMatter`, `extractFrontMatterBlock`. Scalar + block/inline list subset. |
| `_lib/router.ts` | `loadModules`, `buildSymptomMap`, `routeSymptom` (punctuation-insensitive), `buildSweepOrder` (topo-sort by depends-on), `planSweep` (short-circuit: dep failure suppresses dependents). |
| `_lib/checks.ts` | Wraps shared resolver primitives (NO reimpl). `probePeer` (tier-1 createRequire / tier-2 pi packages[]), `detectNameSkew`, `enumeratePiInstalls`, `piVersionDivergence`, `readPiFloor`. |
| `_lib/server-tier.ts` | Additive `/api/*` tier. `fetchHealth`, `fetchPiCoreVersions` — degrade to `{ok:false,reason}` when server down, never throw. |
| `_lib/provenance.ts` | Fact labeller. `fileFact`/`serverFact`/`summariseProvenance` — `serverUnavailable` true when no server-enriched fact. |
| `_lib/knowledge-hash.ts` | Per-module semantic hash. `extractSemanticTokens` (package names + semver, no prose), `computeKnowledgeHash`, `checkDrift`, read/write sidecar. Whitespace-stable; peer rename / floor bump drifts. |
| `_lib/derive-tokens.ts` | `MODULE_TOKEN_SOURCES` maps module→repo-relative derives-from files; `deriveLiveTokens(repoRoot,id)` reads them for the hash. |
| `_lib/regenerate.ts` | CLI: `--check` reports drift, `--write [module]` rewrites sidecars from live sources. Never edits authored prose. `findRepoRoot`, `reportDrift`, `writeHashes`. |
| `modules/env-node.md` | Node version/OS/platform baseline. depends-on: none (root layer). |
| `modules/pi-resolution.md` | Enumerate every pi install (CLI/repo/managed/nvm/cwd), flag divergence + floor violation. depends-on: env-node. |
| `modules/peers.md` | pi-flows + anthropic peer via tier-1/tier-2; detect published-name skew. depends-on: pi-resolution. |
| `modules/plugins-bridges.md` | Bridge `bridgeLoadedFrom`; flag dashboardPluginBridges-only (invisible to pi packages[]); activation status. depends-on: peers. |
| `modules/build-reload.md` | Three-component rebuild/reload gaps (client build / server restart / bridge reload). depends-on: install-topology. |
| `modules/install-topology.md` | Detect npm-global / Electron (immutable) / Docker / dev; topology-specific fix routing. depends-on: env-node. |
| `modules/model-resolution.md` | `model:resolve` handler, roles/preset, `@role` resolvability, pi-flows model-resolve-aware. depends-on: pi-resolution, plugins-bridges. |
| `modules/*.knowledge.hash` | Per-module stored knowledge-hash sidecar (7). Regenerate via `_lib/regenerate.ts --write`. |
