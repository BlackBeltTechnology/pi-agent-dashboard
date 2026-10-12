# Bump evidence — update-pi-core-1-1-adopt-apis

Recorded during implementation against installed pi 1.1.0 (pi-coding-agent, pi-ai, pi-tui, pi-agent-core all 1.1.0; published 2026-10-07). Feeds the PR description.

## 1.4 Install and release-age gate

- `pnpm install` (pnpm 11.15.1) resolves one copy of each at 1.1.0: `pi-coding-agent`, `pi-ai`, `pi-tui`, `pi-agent-core`, `pi-codemode`, `pi-mcp`, `chord`, `pi-telemetry`.
- `pnpm config get minimumReleaseAge` → unset; the `minimumReleaseAgeExclude` list is kept for registries/CI that set it.
- `minimumReleaseAgeExclude` rewritten to the 1.1.0 set derived from `pnpm-lock.yaml` (8 `@earendil-works` packages, all published > 4 days before this run); older `0.83/0.84/0.86/1.0.0` entries and the unresolved `pi-client`/`pi-protocol` entries dropped. `pi-mcp-adapter@2.19.0 || 5.0.0` is not an `@earendil-works` package and stays.
- Engines: pi-coding-agent 1.1.0 `engines.node` `>=22.19.0` (unchanged → Node floor row `{major:22, minor:19}`); TypeBox stays at the resolved `1.3.27`. No pin move.
- `node scripts/verify-release-deps.mjs` → `OK — 11 rules passed.`

## 5.1 Dependency diff (pi-coding-agent 1.0.0 → 1.1.0, from the published `package.json`)

| Field | Change |
|---|---|
| `dependencies` | `@earendil-works/{chord,pi-agent-core,pi-ai,pi-codemode,pi-mcp,pi-tui}` `^1.0.0` → `^1.1.0`; adds `brace-expansion` `5.0.12` |
| `peerDependencies` | none changed |
| `engines` | none changed (`node >=22.19.0`) |
| `exports` | none changed |

No package added or removed other than `brace-expansion`; the dashboard imports none of it.

## 5.1 OAuth-set equality (design D1)

`ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })` then `getProviders().filter(p => p.auth?.oauth)`, run against 1.0.0 and 1.1.0 (the workspace).

**Baseline correction.** My first 1.0.0 install (`npm install @earendil-works/pi-coding-agent@1.0.0`) was contaminated: npm resolved its `^1.0.0` dependencies (`pi-ai`, `pi-tui`, `pi-agent-core`, `pi-codemode`, `pi-mcp`, `chord`) to **1.1.0**, so only `pi-coding-agent` was 1.0.0. Everything below was re-run on a true 1.0.0 set (`npm` `overrides` pinning all seven to 1.0.0; versions verified). The set was identical on the contaminated baseline too, but the pi-ai identity check I drew from it was wrong (see "Late finding").

```
1.0.0 9 ["anthropic","github-copilot","kimi-coding","meta","openai","openai-codex","openrouter","radius","xai"]
1.1.0 9 ["anthropic","github-copilot","kimi-coding","meta","openai","openai-codex","openrouter","radius","xai"]
```

Identical → the `provider-auth-registry` fixtures, the `FLOW_TYPE_HINT` map and the 9-id (8 while Radius is overridden) expectations need no change.

## 5.1 Extension-type diff (`dist/core/extensions/types.d.ts`, 1.0.0 → 1.1.0)

Additive only; no removed or renamed member the dashboard uses.

- `ToolExecutionEndEvent.durationMs?: number` — monotonic `execute()` time. **Adopted** (`event-reducer`, `state-replay`).
- `AgentSettledEvent.aborted: boolean`. **Forwarded unchanged, not consumed** (D3): the bridge forwards the whole event; the reducer's `agent_settled` arm ignores it; tests lock both halves.
- `ToolRendererResolver` / `registerToolRenderer`, tool render-context `durationMs` / `outputPad` / `getPromptGuidelines`: TUI-only. **No-op** (dashboard sessions are headless or tmux).
- `defaultToolModifiers` and `--tools` patterns (`*`, `+name`/`-name`): the dashboard keeps explicit allowlists. **No-op.**
- pi-ai `Model.samplingParamsByThinkingLevel` (`types.d.ts:950`): **adopted** as an opaque passthrough (D6).

## 1.5 Version-anchor sweep

`grep -rnE '\b1\.0\.0\b'` over `packages scripts docker docs qa tests .github openspec/specs README.md pnpm-workspace.yaml package.json`.

Updated (pi pins): `package.json`, every `packages/*/package.json` peer/devDependency, `packages/server/package.json` (`piCompatibility`, dependency), `pnpm-workspace.yaml` (3 overrides + exclude list), `docker/Dockerfile`, `scripts/verify-release-deps.mjs` (`minVersion`, evidence text), `docker/Dockerfile.AGENTS.md` (its stale `0.85.1` row), `scripts/verify-release-deps.mjs.AGENTS.md`, `docs/architecture.md`, `docs/faq.md`, `CHANGELOG.md`.

Justified, not modified:
- Historical "pi 1.0.0 introduced X" comments and docs (`provider-auth-registry`, `begin-flow`, `radius-mcp`, `slash-dispatch`, `terminal-reload`, MCP plugin READMEs): they describe what 1.0.0 added.
- MCP "pi ≥ 1.0.0" lines (`README.md`, `apple-tools`, `mcp-*` plugins, `docs/faq.md`): the built-in MCP's own minimum, still true.
- `locked-json-file.ts` ("first verified on 0.86.1; re-verified unchanged on 1.0.0"): re-verified on 1.1.0 — `dist/core/auth-storage.js` `staleMs = 30_000` and the lock options are byte-identical between 1.0.0 and 1.1.0.
- `openspec/specs/nano-banana-pi-backend`: its runtime guard has its own floor (`VERSION` below `1.0.0` rejected); the published peer range moved with the lockstep, the guard is the feature's own minimum and is verified unchanged.
- `openspec/specs/command-routing` (`expandPromptTemplates` present since 1.0.0) and `provider-auth-server` (Radius targets the default gateway on 1.0.0): statements about 1.0.0 behaviour, identical on 1.1.0 (the OAuth set above; `expandPromptTemplates` still in `dist`).
- Test fixtures using `1.0.0` as an arbitrary or boundary value (`pi-version-skew` pre-release cases, `pi-core-checker`, `pi-version-tracker`, `provider-auth-registry` `VERSION: "1.0.0-test"`, `dependency-declarations` "floor is 1.0.0 or later"): synthetic inputs, not pins.
- `docs/research/*`, `docs/qa/*`: dated records.

## Implementation-time decisions

- **`legacyProviderIds` transport (user decision).** `GET /api/provider-auth/status` returns a bare JSON array that clients pin (`fetchStatus`, `useProvidersReady`, a code comment says so). The spec said "the status response SHALL carry `legacyProviderIds`" without a shape, and an envelope would break those clients (rollback hazard). Decision: a separate read-only route `GET /api/provider-auth/legacy-provider-ids` → `{ legacyProviderIds }` (same pattern as `catalogue-ready`); `/status` stays a bare array; the `provider-auth-server` and `provider-auth-ui` spec deltas and tasks 4.1 / T.16 were amended to match. Older server → 404 → no notice.
- **Agent dir resolution.** The scan reads the runtime `getAgentDir` (via a new `getRuntimeAgentDir()` on `radius-override.ts`, which already owns that handle), falling back to `PI_CODING_AGENT_DIR`, then `~/.pi/agent`. Registry init rewires the runtime source, so route-level tests point the fallback env var at the temp dir.

## Verification runs

- Fixtures first: against the 1.0.0 pins `verify-release-deps-pi-coherence.test.mjs` failed (`server dep = "^1.0.0" is below the 1.1.0 floor`); green after the pin move (70 tests across the three fixture files).
- New/changed tests (all green): `event-reducer.test.ts` (E5–E8, E18), `state-replay.test.ts` (E9), `ToolBurstGroup.test.tsx` (E10), `provider-register-native-models.test.ts` (E11), `internal-registry.test.ts` (E12), `models-json-reader.test.ts`, `scan-legacy-provider-ids.test.ts` (E13–E17, X1–X3, route), `event-forwarder.test.ts` (E18), `ProviderAuthSection.test.tsx` (F1, F2), `pi-version-skew.test.ts` (E1, E4), `verify-release-deps-pi-coherence.test.mjs` (E2), `bundled-node-meets-pi-floor.test.ts` (E3).

## No-weakening guard — accepted exception (human-approved)

`assertNoWeakening` ran over every changed test file; all `ok:true` except one:

| File | Flag | Reason |
|---|---|---|
| `packages/server/src/__tests__/pi-version-skew.test.ts` | strong→permissive (heuristic) | File-level heuristic: any removed `toEqual(...)` line plus any added `.toBeNull()` line in the file. The diff is the 1.0.0 → 1.1.0 pin bump with MORE `expect()` calls added than removed (new "1.0.0 is below the 1.1.0 floor" case, new `1.0.4` blocked boundary); every `toBeNull`/`toEqual` assertion is kept with the new version. Same false positive accepted for this file in `update-pi-core-1-0-adopt-apis`. |

## Step 4.4 enforcers

`check-conventions --base origin/develop`, `dox-byte-gate`, `i18n-lint --strict`, `i18n-parity`, `knip-config` all green. `knip-ratchet`:

| class | now | baseline |
|---|---|---|
| files | 15 | 10 |
| exports | 245 | 234 |
| duplicates | 14 | 12 |

Red on `origin/develop` itself (branch was 0 commits behind it at measurement), so **pre-existing, user-approved**. **Superseded:** develop's `close-e2e-tooling-followups` later lowered the baseline (files 4, exports 231, types 189, duplicates 12) and deleted the dead files; after merging it the ratchet is green (`files 4/4, exports 231/231, types 189/189, duplicates 12/12`) and `--check-baseline-diff origin/develop` passes — no exception remains. No finding is in a file this change adds; the three `exports` findings inside touched files (`event-reducer.ts`: `LIVE_BLOCK_GAP_MARKER`, `applyLiveBlockPiece`, `truncateLines`) predate the change. The 15 unused files are unrelated (`tests/e2e/identity*`, client `DiffView`/`TerminalCard`/`message-queue`/`useAuthStatus`/…, electron lib files, deck3d fixtures). `knip-ratchet --check-baseline-diff origin/develop` passes (no baseline class raised).

## Full suite (`npm test`)

22 failures in 7 files on the first run. Four of those groups are environmental/flaky; **one was wrongly classified here and is a real 1.1.0 effect (X14, below)**:
- `gateway-listener-wiring`, `rendezvous`, `resource-activation-routes`, `resource-activation-toggle` (17 tests): environmental — the sandbox `$TMPDIR` is a long path (unix-socket path limit, symlinked temp roots). All pass with `TMPDIR=/tmp/s`.
- `internal-auth-storage-refresh` X14 (2 tests): **initially recorded as pre-existing — wrong.** The "pi 1.0.0 overlay" used for that claim was the contaminated baseline (pi-ai was 1.1.0). It is a real pi-ai 1.1.0 behaviour change; see "Late finding" and design D7.
- Two real regressions the run found and this change fixed: `mcp-manifest-completeness` (new route needed a `ROUTE_TIERS` entry → `operate`, same as `/status`) and `pi-version-update-handling` X3 (1.0.0 is now below the floor → fixture moved to 1.1.0).

After the fixes: `packages/shared/src` (248 files, 3120 tests) and the touched server/client/extension suites are green.

Verify-gate rerun (`TMPDIR=/tmp/s npm test`, tree at `5e8fa9be3`): **31722 passed, 4 failed in 3 files**.
- `internal-auth-storage-refresh` X14 ×2: real pi-ai 1.1.0 effect, fixed in the follow-up commit (see "Late finding").
- `role-bindings-watcher` X8, `EditorSearchPanel` keyboard: load flakes — both pass in isolation (7/7); no file of this change is in those areas.
- `npm run build`: exit 0.

## Docker harness (step 3)

`docker/test-up.sh -d --build` (image installs `@earendil-works/pi-coding-agent@1.1.0`, seeded `PI_E2E_SEED=1 PI_TEST_PEERS=both PI_E2E_OAUTH=1`), attach mode with `PW_CHANNEL=chrome` (host has no Playwright Chromium):
- First run: 31 specs passed (`faux-tool`, the provider specs, new `pi-1-1-floor-smoke`'s session + health + tool steps); the new spec's duration assertion failed on a regex bug (`\b` between `ms` and `1` in the concatenated header text `Read src/example.ts1ms1 failed`). Fixed.
- Rerun of `pi-1-1-floor-smoke.spec.ts`: 1 passed — session registers, `/api/health` `compatibility.current == "1.1.0"` with no `error`, tool group header shows a duration. Harness torn down (`test-down.sh` via trap) after each run.
- Another worktree's harness held the VM when I first tried (co-resident guard refused: 2 × 4 GiB >= 8 GiB); waited for it to exit rather than oversubscribe.

## X4 install check (T.22)

`pnpm install --frozen-lockfile` and `node scripts/verify-release-deps.mjs` both exit 0 (`11 rules passed`); one resolved copy each of pi-coding-agent / pi-ai / pi-tui at 1.1.0. `qa/tests/01-install.sh` gained a post-install assertion that every resolved copy under the published package is >= 1.1.0 (exercised against a passing and a deliberately-stale fake tree).

## Late finding — pi-ai 1.1.0 OAuth refresh cancellation (design D7)

CI `unit (4)` on PR #866 failed `internal-auth-storage-refresh` X14 ×2; develop's nightly full suite (pi 1.0.0, run 38199030692) passes the file (11 tests, 401 ms). Diffing a **true** 1.0.0 vs 1.1.0 pi-ai (`dist/auth/resolve.js`):

- 1.0.0: `oauth.refresh(current, AbortSignal.any([callerSignal, AbortSignal.timeout(15s)]))` — a caller abort cancelled the refresh.
- 1.1.0: new `refreshStoredOAuthCredential`; `signal` "cancels only the wait for the lock. Once a refresh starts … the refresh and its persistence ignore `signal` and are bounded only by a timeout. Otherwise a cancelled caller could discard the only valid refresh token." `oauth.refresh(current, AbortSignal.timeout(15s))`.

The changelog has no line for this; the triage did not read the pi-ai `dist` diff. Consequences found and fixed (user chose "adopt pi's semantics"):
1. Spec `model-proxy-credential-routing` › "Aborted refresh stops cleanly" (refresh stops, nothing persisted) no longer holds and cannot be reimplemented without patching pi-ai → MODIFIED delta + main spec.
2. The facade's "joiner restarts when its initiator aborted" path now starts a **second concurrent refresh** with a possibly already-rotated refresh token while the first still runs (the credential-store lock is released during the provider call). The shared flight no longer carries any caller's signal; each caller races its own. An already-aborted request starts nothing.
3. Tests X14 / X14b / X14c and the joiner test rewritten to the new contract (shared single refresh, rotated token kept, failure-after-cancel persists nothing); no-weakening guard clean.

Verification: `packages/server/src/model-proxy/__tests__/` 13 files / 157 tests green on 1.1.0.

## Method note

The contaminated baseline also made my local "X14 fails on pristine develop" reproduction meaningless. The reliable signals were develop's nightly CI (passes) vs this branch's CI (fails), then the `resolve.js` diff on a version-verified 1.0.0 set.

## Final integration (after the D7 fix)

Merged `origin/develop` again (3 more commits). Conflicts: `tests/e2e/AGENTS.md` (develop promoted `local-credential-proof-nat` to a sidecar itself — theirs kept) and `event-reducer.ts.AGENTS.md` (union-kept). `tests/e2e/AGENTS.md` sits 11 bytes under the byte cap on develop, so this change adds the spec's sidecar (`pi-1-1-floor-smoke.spec.ts.AGENTS.md`) but no dir row. `pnpm install --frozen-lockfile` rc 0; `verify-release-deps` 11 rules OK; all step-4.4 enforcers green; `packages/server` 673 files / 8684 tests green.
