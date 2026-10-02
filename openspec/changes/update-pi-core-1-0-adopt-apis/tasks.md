## 1. Pins, peers and floor

- [x] 1.1 Update `packages/server/src/__tests__/pi-version-skew.test.ts`, `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` (new `1.0.0` row), `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs` (all governed pins incl. `@earendil-works` peer lower bounds, devDeps, three overrides) and `scripts/__tests__/dependency-declarations.test.mjs` (root + `packages/*`: `@earendil-works` pi peers `>=1.0.0` and optional, no upper bound, no broad `@earendil-works` pi devDeps) first; verify they fail on the current tree
- [x] 1.2 Pin the server dependency, `piCompatibility.minimum/recommended`, root devDependency pi-ai, `docker/Dockerfile` (pi-coding-agent), `scripts/verify-release-deps.mjs` `minVersion` + evidence note, and `pnpm-workspace.yaml` overrides for pi-coding-agent, pi-ai and pi-tui (update the override comment); verify `node scripts/verify-release-deps.mjs` passes
- [x] 1.3 Raise `@earendil-works` pi peers in the root `package.json` and every `packages/*/package.json` to `>=1.0.0` (optional kept, pi-ai cap removed); move broad `@earendil-works` pi devDependencies (e.g. `packages/extension` `pi-tui`) to `^1.0.0`; leave `@mariozechner/*` entries untouched; verify task 1.1 dependency test passes
- [x] 1.4 Confirm `minimumReleaseAge` is not configured where pnpm reads it (add 1.0.0 to `minimumReleaseAgeExclude` if it is); run `pnpm install`; confirm installed pi `engines.node` (`>=22.19.0`) and TypeBox (`1.3.27`, satisfies `^1.3.7`) need no pin move; verify task 1.1 tests pass
- [ ] 1.5 Sweep `rg -l '0\.86\.1' packages scripts docker docs openspec/specs pnpm-workspace.yaml package.json --glob '!**/node_modules/**'`; update or justify each hit (historical "as of pi 0.86.1" wording may stay); verify the list is annotated in the PR description

## 2. Dead gates

- [x] 2.1 Remove the `0.84.2` gate from `packages/extension/src/slash-dispatch.ts`; retire gate tests in `bridge-slash-command-routing.test.ts` / slash-dispatch tests; verify the `command-routing` and `bridge-extension` no-gate scenarios pass
- [x] 2.2 Remove the `0.84.2` gate from reload self-dispatch (`bridge.ts:1801`, `terminal-reload.ts`) and its "minimum pi version" error; verify the `headless-reload` no-gate requirements' scenarios pass
- [x] 2.3 Remove the legacy generation from `packages/shared/src/piai-compat/` (`detect.ts` legacy branch, legacy passthrough in `index.ts`, legacy `dist/oauth.js` preference in `oauth-facade.ts`) and its fakes; add a "legacy module is rejected" test; verify the piai-compat suite passes

## 3. Below-floor signal

- [ ] 3.1 Switch `sendPiVersionIfChanged` to `readRunningPiVersion()`; fix the `protocol.ts` `piVersion` comment; verify with a test that a hoisted newer copy does not mask the running version
- [ ] 3.2 Server: set a below-floor flag on the session record when the reported `piVersion` < `piCompatibility.minimum` (unknown or unparseable → none); verify with unit tests for the below-floor scenarios
- [ ] 3.3 Client: render the warning (running + required version) on the session card and in the chat view; verify with a component test (react-expert checkpoint)

## 4. 0.99–1.0 surface and tolerance

- [ ] 4.1 Add `openai: "auth_code"` to `FLOW_TYPE_HINT` in `packages/server/src/auth/provider-auth-registry.ts`; update `provider-auth-registry.test.ts` exact sets to the 1.0.0 set; verify tests pass
- [ ] 4.1a Add a provider-auth adapter test: the 1.0.0 Anthropic login's first prompt (`select`, options `browser`/`copy_code`) surfaces as a pending `select` step and answering `browser` continues to the auth URL; verify it passes against installed 1.0.0 (test-plan #E15)
- [ ] 4.2 Add `agent_before_settle` to the bridge pass-through list with no status effect; make replay tolerate `context_edit`; verify with a replay fixture containing `context_edit` and a status-extraction test
- [ ] 4.3 Settings writers (resource toggle, project-init) preserve `-builtin:<name>` in `extensions` and `+name`/`-name` in `defaultTools`; verify with round-trip tests
- [ ] 4.4 Make `session-sync.ts:119,242` and `bridge.ts:3060` tolerate a not-yet-created session file; verify with a test and a real spawn that registers before the first prompt with no error logged

- [ ] 4.5 Bridge: copy `getProviderAuthStatus(id).label` into the catalogue entry as `authLabel` (shared catalogue type); server: copy it onto the env-sourced api-key status row and count it as `authenticated`; client: Environment mechanism text uses `authLabel`; verify with tests for test-plan #E16, #E17, #F2
- [ ] 4.6 Registry: carry pi's OAuth `isSubscription` as `subscription` on registry entries and OAuth status rows; client: "Account" badge when `subscription === false`; verify with tests for test-plan #E18, #F3
- [ ] 4.7 Add codemode image regression tests (live `tool_execution_end` + replay) for test-plan #E19; fix the render path only if they fail

## 5. Bump evidence, verification and docs

- [ ] 5.1 Run the in-memory draft-agent path (`commit-draft-agent.ts`) against installed 1.0.0; record the evidence and the restore-API decision in the PR description
- [ ] 5.2 Record a repo-wide search showing no references to `@earendil-works/pi-codemode`, `@earendil-works/pi-mcp` or `quickjs-wasi`, and unchanged pi import specifiers; verify the evidence is in the PR description
- [ ] 5.3 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `resource-activation-toggle.test.ts` against the installed 1.0.0; verify green
- [ ] 5.4 Full rebuild, restart, and smoke-test a real headless and tmux session: spawn, extension slash command, `/reload` on both kinds, model list (incl. an async-discovered custom provider under an `enabledModels` pattern), thinking selector, a user-launched session on an older global pi showing the below-floor warning; sign in with ChatGPT and with Anthropic (both browser and copy-code methods) from the providers page; verify `/api/health` reports `1.0.0`
- [ ] 5.5 Verify `openspec validate update-pi-core-1-0-adopt-apis`; delegate `docs/architecture.md` and other `docs/*.md` pin updates to DocScribe; add a `CHANGELOG.md` `## [Unreleased]` **BREAKING** entry (peer floor); update touched `AGENTS.md` rows with `See change: update-pi-core-1-0-adopt-apis`

## 6. Scenario tests (from test-plan.md)

- [x] 6.1 L1 test for lockstep floor boundaries — see `packages/server/src/__tests__/pi-version-skew.test.ts`; running `0.99.2`/`1.0.0`/`1.0.1` against min=rec `1.0.0` · `computeCompatibility()` · error only for `0.99.2`, naming both versions (test-plan #E1)
- [x] 6.2 L1 test for publishable peer ranges — see `scripts/__tests__/dependency-declarations.test.mjs`; root + `packages/*` manifests plus `>=0.80.10` / `<0.87.0` fixtures · dependency check · all `>=1.0.0` optional uncapped, fixtures fail naming the manifest (test-plan #E2)
- [x] 6.3 L1 test rejecting a broad pi devDependency — see `scripts/__tests__/dependency-declarations.test.mjs`; fixture devDep `pi-tui >=0.80.10` · dependency check · fails naming the manifest (test-plan #E3)
- [x] 6.4 L1 test for release-deps coherence — see `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs`; all pins `1.0.0`, then single drifts (pi-tui override, peer lower bound, `minimum`) · `verify-release-deps.mjs` · pass, then fail naming each drifted location (test-plan #E4)
- [ ] 6.5 L1 test for the below-floor flag — see `packages/server/src/__tests__/pi-version-skew.test.ts`; reported `0.87.1`/`1.0.0`/undefined/`"dev"` with min `1.0.0` · `pi_version_update` handling · flag only for `0.87.1` (test-plan #E5)
- [ ] 6.6 L1 test that the running pi version is reported — see `packages/extension/src/__tests__/pi-version-tracker.test.ts`; argv manifest `0.87.1`, hoisted `1.0.0` · `sendPiVersionIfChanged()` · sends `0.87.1` (test-plan #E6)
- [x] 6.7 L1 test for ungated slash dispatch — see `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts`; `/ctx-stats`, throwing version reader · `tryDispatchExtensionCommand` · `sendUserMessage` with `expandPromptTemplates:true`, `started`→`completed`, reader never called (test-plan #E7)
- [x] 6.8 L1 test for ungated reload self-dispatch — see `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts`; terminal-hosted bridge, throwing version reader · forwarded `/reload` · `/__dashboard_reload <token>` dispatched, no minimum-version error (test-plan #E8)
- [x] 6.9 L1 test for factory-only pi-ai adaptation — see `packages/shared/src/piai-compat/__tests__/subpath.test.ts`; factory / legacy-only / partial fakes · `adaptPiAi()` · adapted / legacy error / missing-members error (test-plan #E9)
- [ ] 6.10 L1 test for the 1.0.0 OAuth registry — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; installed 1.0.0 providers · registry build · exact 8-id set, `openai` `auth_code`, no `radius` (test-plan #E10)
- [ ] 6.11 L1 test for built-in settings round-trip — see `tests/e2e/resource-activation-trust.spec.ts` for the settings shape and the resource-toggle unit tests for harness; `-builtin:mcp` + `defaultTools ["+codemode"]` · toggle `foo` · both entries preserved (test-plan #E11)
- [ ] 6.12 L1 test for 0.87 shape tolerance — see `packages/client/src/__tests__/state-replay.test.ts` and `packages/server/src/__tests__/event-status-extraction.test.ts`; JSONL with `context_edit` null on a user message, an `agent_before_settle` event · replay / extraction · message still rendered, no throw, status not idle (test-plan #E12)
- [ ] 6.13 L1 test for late-discovered in-scope models — see `packages/extension/src/__tests__/filter-enabled-models.test.ts`; `enabledModels ["myprovider/*"]`, provider registered after start · `onProviderChanged` push · new models included (test-plan #E13)
- [ ] 6.14 L1 test that thinking `max` stays fail-closed — see the existing `provider-register` thinking-level tests; `thinkingLevelMap.max` set, runtime without `max` · model-list push · no `max` (test-plan #E14)
- [ ] 6.15 L1 component test for the below-floor warning — see `packages/client/src/components/session/__tests__/SessionCard-status-shape.test.tsx`; flagged record `0.87.1` vs `1.0.0` · render card + chat · warning names both, absent when unflagged (test-plan #F1)
- [ ] 6.16 L1 test for a not-yet-created session file — see `packages/extension/src/__tests__/` session-sync tests; `getSessionFile()` → non-existent path · register + state sync · succeeds, no error logged (test-plan #X1)
- [ ] 6.17 Manual: sign in with ChatGPT from the providers page and confirm the credential appears (test-plan: manual-only, #X2)
- [ ] 6.18 Manual: user-launched session on global pi 0.87.x shows a legible below-floor warning on card and chat (test-plan: manual-only, #X3)
- [ ] 6.19 L1 test for the federation catalogue label — see `packages/extension/src/__tests__/build-provider-catalogue.test.ts`; registry status `{configured, source:"environment", label:"workload identity federation"}`, no env keys · `buildProviderCatalogue()` · entry has `authLabel`, no `envVar`/`ambient` (test-plan #E16)
- [ ] 6.20 L1 test for the federation status row — see `packages/server/src/__tests__/build-auth-status.test.ts`; catalogue entry from 6.19, empty `auth.json` · `_buildAuthStatus` · `anthropic-api` configured+authenticated+`authLabel`, `anthropic` OAuth row not configured (test-plan #E17)
- [ ] 6.21 L1 test for the subscription flag — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; installed 1.0.0 · registry build · `openrouter` `subscription:false`, the other seven `true` (test-plan #E18)
- [ ] 6.22 L1 test for codemode images — see `packages/client/src/__tests__/state-replay.test.ts` and the reducer `tool_execution_end` image tests; codemode result with text + PNG block · live reduce and replay · one image on the codemode card in both (test-plan #E19)
- [ ] 6.23 L1 component test for Environment mechanism and Account badge — see `packages/client/src/components/settings/__tests__/` ProviderAuthSection tests; federation row; `openrouter` OAuth row `subscription:false`; row without `subscription` · render · "workload identity federation", "Account", "Subscription" (test-plan #F2, #F3)
