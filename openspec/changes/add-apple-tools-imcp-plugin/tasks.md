## 1. Core: `paths` requirement category

Lands first and standalone — no consumer yet, independently testable (design.md Migration Plan step 1).

- [x] 1.1 Add `paths?: string[]` to `PluginRequirements` in `packages/shared/src/dashboard-plugin/manifest-types.ts` with a doc comment naming the `.app`-bundled use case
- [x] 1.2 Add `paths: { name: string; satisfied: boolean }[]` to `PluginRequirementReport` in `packages/shared/src/dashboard-plugin/plugin-status.ts`
- [x] 1.3 Implement `probePath()` in `packages/dashboard-plugin-runtime/src/server/requirement-probes.ts` — existence check only, no execution, no content read
- [x] 1.4 Wire `paths` into `runRequirementProbesFor()` and `missingFromReport()`, preserving existing category ordering
- [x] 1.5 Implement `${configKey}` resolution in `probePath()` against the declaring plugin's validated config — a config read, never a shell expansion (see `config-validator.ts` for the validated-config source)
- [x] 1.6 Update `manifest-validator.ts` to accept and validate the `paths` category
- [x] 1.7 Ensure `paths` results participate in the existing 30s TTL cache

### Tests — group 1

Exemplar for every row below: `packages/dashboard-plugin-runtime/src/__tests__/requirement-probes.test.ts` (probe harness + dep injection); for 1.T6 also `manifest-validator-requires.test.ts`.

- [x] 1.T1 (test-plan #E16) L1: existing absolute path declared · probe runs · `paths[0].satisfied === true` — see `requirement-probes.test.ts`
- [x] 1.T2 (test-plan #E17) L1: non-existent absolute path declared · probe runs · `satisfied === false` and name present in `missingRequirements` — see `requirement-probes.test.ts`
- [x] 1.T3 (test-plan #E18) L1: existing absolute path containing spaces · probe runs · `satisfied === true`, no character denylist rejects it — see `requirement-probes.test.ts`
- [x] 1.T4 (test-plan #E19) L1: relative path `./imcp-server` · probe runs · `satisfied === false`, not resolved against cwd — see `requirement-probes.test.ts`
- [x] 1.T5 (test-plan #E20) L1: path containing `;` `&&` `$()` · probe runs · treated as opaque path, assert 0 child processes spawned — see `requirement-probes.test.ts`
- [x] 1.T6 (test-plan #E21) L1: config sets `imcpServerPath` to an existing absolute path · probe runs · satisfied, resolved value equals config value — see `requirement-probes.test.ts` + `config-validator.test.ts`
- [x] 1.T7 (test-plan #E22) L1: key left at schema default · probe runs · resolves default, identical to an equivalent literal — see `requirement-probes.test.ts`
- [x] 1.T8 (test-plan #E23) L1: placeholder names a key absent from `configSchema` · probe runs · unsatisfied, no throw, other three categories still probed — see `requirement-probes.test.ts`
- [x] 1.T9 (test-plan #E24) L1: key resolves to a relative path · probe runs · unsatisfied, no throw — see `requirement-probes.test.ts`
- [x] 1.T10 (test-plan #E25) L1: manifest with `piExtensions`+`binaries` only · probe runs · `report.paths === []`, `missingRequirements` content AND ordering byte-identical to pre-change baseline — see `requirement-probes.test.ts`
- [x] 1.T11 (test-plan #E26) L1: manifest with no `requires` · probe runs · `missingRequirements === []`, no throw — see `requirement-probes.test.ts`
- [x] 1.T12 (test-plan #P3) L1: two probes inside the cache window · second probe · 0 filesystem stats performed — see `requirement-probes.test.ts` (TTL cache section)
- [x] 1.8 Run `npm test 2>&1 | tee /tmp/pi-test.log` — group 1 green, no regressions in existing plugin-runtime tests

## 2. Core: activation-UI surfacing

- [x] 2.1 Add a `pathsMissing` list to `MissingRequirementsBlock` in `packages/client/src/components/packages/PluginsSection.tsx` and render it alongside the existing three categories (currently derives lists from `requirements.{piExtensions,binaries,services}` only, using `missingRequirements` merely as an early-return guard)

### Tests — group 2

Exemplar for every row below: `tests/e2e/recommended-requires.spec.ts` (requirement-pill rendering against the docker harness).

- [x] 2.T1 (test-plan #F1) L3: plugin row with an unsatisfied `paths` requirement · Plugins tab rendered · warning pill naming the requirement present AND block not empty — see `tests/e2e/recommended-requires.spec.ts`
- [x] 2.T2 (test-plan #F2) L3: unsatisfied `paths` requirement · Plugins tab rendered · NO inline `[Install]` button — see `tests/e2e/recommended-requires.spec.ts`
- [x] 2.T3 (test-plan #F3) L3: unsatisfied `pi-mcp-adapter` `piExtensions` requirement · Plugins tab rendered · `[Install via Packages tab]` link, NOT an inline `[Install]` button — see `tests/e2e/recommended-requires.spec.ts`
- [x] 2.2 Verify no change to `piExtensions` / `binaries` / `services` pill or install-button behaviour

## 3. Package scaffold

- [x] 3.1 Create `packages/apple-tools/` with `package.json` — name `@blackbelt-technology/pi-dashboard-apple-tools`, version `0.7.0`, `publishConfig.access: public`, repository directory field, keywords per proposal
- [x] 3.2 Declare `pi-mcp-adapter` in `dependencies` — NOT in `bundledDependencies`, NOT referenced from `pi.extensions`. NOTE: documentary only; it does NOT satisfy the `requires.piExtensions` probe, which reads `listInstalled("global")`, not nested npm deps
- [x] 3.3 Declare `@blackbelt-technology/pi-dashboard-shared` as a dependency — required for `sourcesMatch()` (`packages/shared/src/source-matching.ts`); do NOT reimplement cross-kind matching locally
- [x] 3.4 Add `pi.skills: [".pi/skills/apple-tools"]` and the `bin` entry `pi-apple-tools-install`
- [x] 3.5 Add `tsconfig.json` and `vitest.config.ts` matching sibling package conventions
- [x] 3.6 Confirm `pnpm-workspace.yaml` glob covers the new directory; run `pnpm install` and verify the workspace resolves

### Tests — group 3

- [x] 3.T1 (test-plan #E30) L1: package installed as a dependency · `npm install` completes · 0 provisioning traversals, 0 `brew` invocations, manifest has no `postinstall`/lifecycle script — see `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` for the manifest-assertion harness pattern

## 4. Provisioning state machine

Every probe injectable — the suite must pass on Linux. Exemplar for all group-4 tests: `packages/dashboard-plugin-runtime/src/__tests__/requirement-probes.test.ts` (dep-injection shape), sibling `packages/apple-tools/src/__tests__/`.

- [x] 4.1 Implement `src/detect.ts` — pure injectable probes for platform, OS version, path existence, executable resolution
- [x] 4.2 Implement the traversal in `src/install.ts` as a state machine with a shared `check`/`write` mode flag, exposing the closed nine-member terminal-state enum, including the post-brew re-discovery gate
- [x] 4.3 Implement `--check` as the write-suppressed twin sharing one implementation
- [x] 4.4 Implement the manual-handoff output: `READY_PENDING_GRANTS` names the menu-bar activation step and states grants cannot be automated
- [x] 4.5 Implement per-session caching as process-local state keyed by resolved config — no cache file, no cross-session persistence; cleared explicitly on run-installer and on any config write
- [x] 4.6 Assert the CLI writes exactly TWO files (`mcp.json`, `settings.json`) and never touches the plugin config store (server-owned via `server-context.ts:269` `updatePluginConfig`)

### Tests — group 4

- [x] 4.T1 (test-plan #E1) L1: injected `platform="linux"` · installer invoked · `UNSUPPORTED_PLATFORM`, exit 0, 0 filesystem writes, 0 subprocess spawns, message names iMCP as macOS-only
- [x] 4.T2 (test-plan #E2) L1: injected `platform="win32"` · installer invoked · identical to #E1, no Windows-specific branch
- [x] 4.T3 (test-plan #E3) L1: injected `platform="darwin"` · installer invoked · proceeds to version probe, `sw_vers` called exactly once
- [x] 4.T4 (test-plan #E4) L1: `sw_vers` → `15.2` · version gate · `OS_TOO_OLD`, non-zero, message names both `15.2` and `15.3`
- [x] 4.T5 (test-plan #E5) L1: `sw_vers` → `15.3` · version gate · passes (inclusive floor), continues to discovery
- [x] 4.T6 (test-plan #E6) L1: `sw_vers` → `15.10` · version gate · passes — numeric compare, NOT lexical
- [x] 4.T7 (test-plan #E7) L1: `sw_vers` → `26.0` · version gate · passes, no upper-bound regression
- [x] 4.T8 (test-plan #E8) L1: `sw_vers` → `14.6` · version gate · `OS_TOO_OLD`, non-zero, no filesystem write
- [x] 4.T9 (test-plan #E9) L1: `sw_vers` absent / exits 1 / empty stdout · version gate · `OS_VERSION_UNKNOWN` (NOT `OS_TOO_OLD`), message asserts no detected version
- [x] 4.T10 (test-plan #E10) L1: override unset, `/Applications/…/imcp-server` exists · discovery · that path recorded, install branch skipped
- [x] 4.T11 (test-plan #E11) L1: `/Applications` absent, `~/Applications/…/imcp-server` exists · discovery · user-local path recorded, install branch skipped
- [x] 4.T12 (test-plan #E12) L1: override set to an existing path, `/Applications` also exists · discovery · override wins, candidate list not consulted
- [x] 4.T13 (test-plan #E13) L1: override set to a NON-existent path, `/Applications` exists · discovery · falls through to candidate list — pins override-as-preference-not-veto
- [x] 4.T14 (test-plan #E14) L1: every injected combination across platform × version × app × brew × config · full traversal matrix · reported state ∈ the 9-member enum on every path, no unnamed error escapes
- [x] 4.T15 (test-plan #E15) L1: cask fails / config unparseable / config unwritable · three traversals · `INSTALL_FAILED` / `CONFIG_UNPARSEABLE` / `CONFIG_WRITE_FAILED`, no two collapse
- [x] 4.T16 (test-plan #E31) L1: unprovisioned macOS host · `--check` · reports the state it would reach, 0 files created/modified, `brew` never invoked
- [x] 4.T17 (test-plan #E32) L1: identical injected host state · `--check` vs write-mode · both report the same terminal state
- [x] 4.T18 (test-plan #X1) L1: `brew` absent, app absent · install branch · `NO_INSTALL_METHOD`, non-zero, message contains the download URL
- [x] 4.T19 (test-plan #X2) L1: `brew install --cask` exits 1 with stderr · install branch · `INSTALL_FAILED`, stderr surfaced verbatim, 0 retries, 0 config writes
- [x] 4.T20 (test-plan #X4) L1: `brew` stalls indefinitely · install branch · terminates at 10 min with `INSTALL_FAILED` and a timeout-specific message, no config write
- [x] 4.T21 (test-plan #X5) L1: cask exits 0 but no binary at any candidate · re-discovery gate · `INSTALL_FAILED`, NO mcp.json entry written
- [x] 4.T22 (test-plan #P1) L1: 100 sequential skill-load checks with injected probes · macOS · p95 < 200ms
- [x] 4.T23 (test-plan #P2) L1: 100 sequential checks, `platform="linux"` · non-macOS · p95 < 5ms AND 0 subprocesses spawned
- [x] 4.T24 (test-plan #X23) L1: full installer suite on Linux CI · `npm test` · every scenario passes via injected probes, 0 reads of a real `/Applications` path, 0 real `brew` invocations

## 5. Config writers (security-critical)

Invoke the `security-hardening` discipline skill before implementing — user-owned config files, subprocess invocation.

- [x] 5.1 Implement `src/mcp-config.ts` — read, deep-merge the single `mcpServers.iMCP` key, atomic temp-file + rename write
- [x] 5.2 Implement the `settings.json` `packages[]` append-if-absent path with the same merge-only/atomic/abort discipline, using `sourcesMatch()` for presence detection
- [x] 5.3 Audit every subprocess call site: `brew` invoked with an argv array, never through a shell; no probed value interpolated into a shell string
- [x] 5.4 Verify against the installed `pi-mcp-adapter` which `mcpServers.<id>` fields are required (`type`, `args`, `env`) and pin the written entry shape with a test — do NOT infer from the iMCP README's Claude Desktop example
- [ ] 5.5 Spawn the `Audit` subagent on this group's diff (untrusted input + user-owned file writes + subprocess invocation)

### Tests — group 5

- [x] 5.T1 (test-plan #X6) L1: config holds an unrelated `mcpServers.other` entry + unknown top-level keys · installer writes · both survive verbatim alongside the new `iMCP` entry
- [x] 5.T2 (test-plan #X7) L1: mcp.json present but invalid JSON · installer writes · `CONFIG_UNPARSEABLE`, non-zero, parse error reported, original byte-identical
- [x] 5.T3 (test-plan #X8) L1: settings.json present but invalid JSON · installer appends · `CONFIG_UNPARSEABLE`, original byte-identical
- [x] 5.T4 (test-plan #X10) L1: mcp.json write interrupted mid-rename · installer writes · file is complete-old or complete-new, never truncated
- [x] 5.T5 (test-plan #X11) L1: settings.json write interrupted mid-rename · installer appends · as #X10
- [x] 5.T6 (test-plan #X12) L1: parseable config, `EACCES` on rename · installer writes · `CONFIG_WRITE_FAILED` (NOT coerced to `CONFIG_UNPARSEABLE`), original byte-identical
- [x] 5.T7 (test-plan #X13) L1: `ENOSPC` on rename / uncreatable parent dir · installer writes · `CONFIG_WRITE_FAILED`, original byte-identical
- [x] 5.T8 (test-plan #X14) L1: a sibling MCP config layer contains a secret-bearing entry · installer writes · no value from any other layer appears in the written file
- [x] 5.T9 (test-plan #X3) L1: discovered path containing `; rm -rf /` · brew + all subprocess call sites · `brew` invoked with an argv array, no probed value reaches a shell string
- [x] 5.T10 (test-plan #E27) L1: fully provisioned host · installer run twice · same state, exactly one `mcpServers.iMCP` key, ≤1 adapter entry in `packages[]`
- [x] 5.T11 (test-plan #E28) L1: `packages[]` with 23 pre-existing entries · installer appends · all 23 retain original relative order, none removed
- [x] 5.T12 (test-plan #E29) L1: `packages[]` already holds a git-sourced `pi-mcp-adapter` · installer runs · no npm duplicate appended (exercises `sourcesMatch()`)
- [x] 5.T13 (test-plan #X15) L1: no dashboard server running · CLI installer runs · completes normally, writes exactly 2 files, never reaches `updatePluginConfig`

## 6. Skill

- [x] 6.1 Author `.pi/skills/apple-tools/SKILL.md` enumerating the seven reachable services (Calendar, Contacts, Location, Maps, Messages, Reminders, Weather)
- [x] 6.2 Document the Mail exclusion prominently: iMCP exposes no Mail service, "Messages" is iMessage/SMS not email, redirect to `apple-mail-fast-export`
- [x] 6.3 Document the adapter's search-then-invoke access pattern; state the agent must not spawn `imcp-server` directly
- [x] 6.4 Wire the load-time `--check` with per-session caching
- [x] 6.5 Document TCC revocation as undetectable ahead of a call, and that a permission-class failure means menu-bar remediation rather than re-running the installer
- [x] 6.6 Verify the skill's trigger phrasing does not collide with `apple-mail-fast-export`

### Tests — group 6

- [x] 6.T1 (test-plan #X20) L1: agent asked to search Apple Mail · skill consulted · skill states iMCP exposes no Mail service and names `apple-mail-fast-export`, 0 iMCP tool calls attempted
- [x] 6.T2 (test-plan #X21) L1: agent evaluates whether "Messages" satisfies an email request · skill consulted · documentation identifies Messages as iMessage/SMS only
- [x] 6.T3 (test-plan #X22) L1: macOS host, no iMCP app · skill loads · reports the gap, names the installer command, attempts 0 Apple-data tool calls

## 7. Dashboard plugin

- [x] 7.1 Add the `pi-dashboard-plugin` manifest — id `apple-tools`, `requires: { piExtensions: ["pi-mcp-adapter"], paths: ["${imcpServerPath}"] }`, `configSchema`, `server`, `client`
- [x] 7.2 Author `config.schema.json` (JSON Schema 7) with `imcpServerPath` defaulting to the canonical `/Applications` location — the key the manifest's `paths` entry interpolates
- [x] 7.3 Implement the plugin `server/` entry exposing the provisioning state and the run-installer action, delegating to the shared checker from group 4
- [x] 7.4 Implement **server-side** path reconciliation: when the server's check discovers the binary at a non-default candidate, persist it to `imcpServerPath` via `updatePluginConfig` — runs in the server (which owns the store), NOT the CLI
- [x] 7.5 Implement `client/AppleToolsSettings.tsx` claiming `settings-section` **without** a `tab` field — per `openspec/specs/dashboard-plugin-loader/spec.md:1043` it renders inline under the plugin's own row; do NOT add a `SettingsTab` union member, do NOT touch `SettingsPanel.tsx`
- [x] 7.6 Implement panel controls: status readout, `[Run installer]`, server enable/disable, `directTools` selection, path override
- [x] 7.7 Implement server enable/disable as a `disabled` override written to the project-local `.pi/mcp.json`
- [ ] 7.8 Verify against the installed `pi-mcp-adapter` that it actually reads the `disabled` flag from the project-local layer — if not, the toggle is a silent no-op and must be reworked before shipping
- [x] 7.9 Fold the disabled state into the panel's status readout
- [x] 7.10 Implement the non-macOS inert state: unsupported-platform readout, run-installer action not offered

### Tests — group 7

Exemplar for L3 rows: `tests/e2e/anthropic-bridge-activation.spec.ts` (plugin row + activation UI against the docker harness on the `.pi-test-harness.json` `dashboardPort` — never hardcode `:18000`).

- [x] 7.T1 (test-plan #E33) L1: operator override set explicitly; server check discovers a different path · server check runs · override left unmodified, write-back fires only on unset/default
- [ ] 7.T2 (test-plan #F4) L3: provisioned host, plugin enabled · settings-gear affordance on the plugin row clicked · section renders inline beneath that row, renders on NO other settings page — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T3 (test-plan #F5) L3: plugin disabled in config · Plugins tab rendered · claim filtered out, no section rendered — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T4 (test-plan #F6) L3: unprovisioned macOS host · panel rendered · displays the shared checker's terminal state, vocabulary identical to the CLI's — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T5 (test-plan #F7) L3: panel showing an unprovisioned state · `[Run installer]` completes, then a config write · cache cleared on both events, panel converges without manual reload — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [x] 7.T6 (test-plan #F8) L3: dashboard on a non-macOS host · panel rendered · unsupported-platform readout, `[Run installer]` absent — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T7 (test-plan #F9) L3: fully provisioned host · panel rendered · 0 controls purporting to toggle an individual Apple service; pending-grants copy delegates to the menu bar and states grants cannot be automated — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T8 (test-plan #F10) L3: provisioned host · operator toggles the iMCP server off · `disabled` written to project-local `.pi/mcp.json`, `~/.pi/agent/mcp.json` `command` entry byte-identical — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T9 (test-plan #F11) L3: server disabled AND host provisioned · panel rendered · status does not simultaneously read `READY_PENDING_GRANTS` and `disabled` — see `tests/e2e/anthropic-bridge-activation.spec.ts`
- [ ] 7.T10 (test-plan #X9) L3: provisioned host, grant revoked out of band · Apple-data tool called · [NEEDS CLARIFICATION: observable — pin iMCP's concrete permission-class error shape against a live host during implementation, then author] — see `tests/e2e/anthropic-bridge-activation.spec.ts`

## 7b. Production bundling (CI gate)

- [x] 7b.1 Add `"apple-tools"` to `BUNDLED_PLUGINS` in `packages/electron/scripts/bundle-server.mjs:122`
- [x] 7b.2 (test-plan #E34) L1: `apple-tools` present under `packages/` with a plugin manifest · `bundled-plugins-complete.test.ts` runs · test passes, id present in `BUNDLED_PLUGINS` — see `packages/shared/src/__tests__/bundled-plugins-complete.test.ts`
- [ ] 7b.3 Verify a production build places the plugin under the bundled-plugins resource directory (production discovery reads `resources/plugins/`)

## 8. Doctor skill probe

- [x] 8.1 Add the Apple-tools provisioning probe to the `doctor` skill, deriving state from the shared write-suppressed checker

### Tests — group 8

- [x] 8.T1 (test-plan #X16) L1: Apple-tools package absent from the host · doctor runs · probe reports package absent, every other doctor probe completes normally
- [x] 8.T2 (test-plan #X17) L1: any host state · doctor probe runs · 0 config files created/modified, 0 install attempts
- [x] 8.T3 (test-plan #X18) L1: identical injected host state · doctor probe vs CLI `--check` · identical terminal state
- [x] 8.T4 (test-plan #X19) L1: doctor on Linux · doctor runs · Apple-tools probe reports unsupported-platform, NOT flagged as requiring remediation

## 9. Recommended-extensions entry

Lands last — the only user-visible surface, gated on groups 1–8 being real (design.md Migration Plan step 3).

- [x] 9.1 Add the entry to `packages/shared/src/recommended-extensions.ts` with `status: "optional"`, `dashboardPlugin: "apple-tools"`, `requires: { piExtensions: ["pi-mcp-adapter"] }`, `unlocks`, `fallbackDescription`
- [ ] 9.2 Verify existing `recommended-extensions.test.ts` invariants still hold (npm-sourced, absent from `BUNDLED_EXTENSION_IDS`)
- [ ] 9.3 Verify the install browser renders the `+plugin: apple-tools` badge via `dashboardPluginInstalled` enrichment

## 10. Documentation

Every write under `docs/` is delegated to the DocScribe subagent in caveman style; source-tree `AGENTS.md` rows are edited directly by the main agent.

- [x] 10.1 Write `packages/apple-tools/README.md` — install, provision, manual grant step, the Mail exclusion
- [x] 10.2 Scaffold `packages/apple-tools/AGENTS.md` via `kb dox init` and add a row per file
- [x] 10.3 Add per-file rows for the changed core files to `packages/shared/src/AGENTS.md`, the plugin-runtime tree, and the client packages tree, each with `See change: add-apple-tools-imcp-plugin`
- [x] 10.4 Spawn DocScribe to record the `paths` requirement category and its `${configKey}` interpolation in `docs/architecture.md`
- [x] 10.5 Add `docs/faq.md` entries for "how do I reach Apple Calendar/Contacts from pi" and "why can't I read Apple Mail through iMCP"
- [x] 10.6 Add the CHANGELOG `## [Unreleased]` entry

## 11. Validate

- [x] 11.1 Run `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — full suite green
- [x] 11.2 Run `npm run quality:changed` and clear the Biome ratchet on the diff
- [ ] 11.3 Invoke the `review-code` discipline skill on the complete diff and resolve findings
- [x] 11.4 Run `openspec validate add-apple-tools-imcp-plugin` — clean
- [ ] 11.5 (test-plan #F12, manual-only) Panel visual fit across all 4 themes — human judgment, deferred post-merge
- [ ] 11.6 Manual QA on a real macOS host: unprovisioned → installer → menu-bar grants → a live Calendar tool round-trip through the adapter
- [ ] 11.7 Manual QA: settings panel status readout and `[Run installer]` against the same host
- [ ] 11.8 Manual QA on a non-macOS host: installer no-ops cleanly, doctor reports unsupported-platform without flagging a fault
