## 1. Version bump (single-source pins)

- [ ] 1.1 `packages/server/package.json`: dep `@earendil-works/pi-coding-agent` `^0.81.1 → ^0.83.0`.
- [ ] 1.2 `packages/server/package.json`: `piCompatibility.recommended 0.81.1 → 0.83.0` (leave `minimum: 0.78.0`, `maximum: null`).
- [ ] 1.3 `scripts/verify-release-deps.mjs`: bump the pi `minVersion → 0.83.0` and update the descriptive rationale string.
- [ ] 1.4 `docker/Dockerfile`: global install pin `@earendil-works/pi-coding-agent@0.81.1 → @0.83.0`.
- [ ] 1.5 `packages/extension/package.json`: bump devDep `typebox ^1.1.33 → ^1.3.7` (match pi's bundled runtime TypeBox so the suite validates against runtime).
- [ ] 1.6 Refresh `pnpm-lock.yaml`; refresh the `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` (`@earendil-works/pi-agent-core|pi-ai|pi-coding-agent|pi-tui@0.81.1 → @0.83.0`); confirm the electron bundle (`bundle-server.mjs`) resolves the server's `^0.83.0` — no independent electron pin to edit.
- [ ] 1.7 DocScribe: update the pinned-version row in `docker/AGENTS.md` (caveman style).

## 2. Enforce pin coherence in the release-deps checker

- [ ] 2.1 Extend `scripts/verify-release-deps.mjs` so the pi rule also asserts `piCompatibility.recommended` and the `docker/Dockerfile` global-install pin resolve to the same **normalized** version as the server dep (reuse the existing `floorOf()`-style normalizer — the three pins have different syntaxes `^0.83.0` / `0.83.0` / `@0.83.0`), failing and naming the drifted location on mismatch. Follow the exported-fn + fixture-test pattern in `__tests__/verify-release-deps-openspec-floor.test.mjs`.

## 3. TypeBox 1.3.7 breaking-change verification (verify, not migrate)

- [ ] 3.1 Re-audit `packages/extension/src` for removed APIs (`Type.Base/Awaited/Promise/AsyncIterator/Iterator/Options`, `Value.Mutate`) — expect zero.
- [ ] 3.2 With the devDep at `^1.3.7`, verify the extension's optional-array tool args (e.g. `ask-user` `options: Type.Optional(Type.Array(...))`) accept/reject the same `null`/missing/valid argument shapes as before the bump (nullable-array validation fix is the live risk — NOT schema `anyOf` emission).
- [ ] 3.3 Run the full extension vitest suite against resolved `0.83.0` + TypeBox `1.3.7`; fix any schema/validation regressions surfaced.

## 4. Adopt `ctx.scopedModels` (scope-aware `list_models`)

- [ ] 4.1 Confirm `ctx.scopedModels` exists on the ExtensionContext at runtime under resolved `0.83.0` (upstream `#7191` documents it; not present on the local `0.80.10`). Read it from the **live ctx at `list_models` call time**, not a one-time snapshot at register — the scope is dynamic (Ctrl+P cycling) and a cached capture would go stale. Guard so an absent surface never throws.
- [ ] 4.2 In `role-model-tools.ts`, gate on **non-empty length** (`Array.isArray(ctx.scopedModels) && ctx.scopedModels.length > 0`); when non-empty, derive each entry's ref as `` `${entry.model.provider}/${entry.model.id}` `` (entry.model is a Model object, not a ref) and intersect against the same ref key the tool already builds (`` `${m.provider ?? ""}/${m.id ?? ""}` ``), preserving `ref` shape and the `registryReady`/`reason` discriminator. Absent OR empty → no filter.

## 5. Streaming bash + bash session env — feasibility spike (no code unless applicable)

- [ ] 5.1 Investigate whether any dashboard bash path can surface `bash_execution_update` (RPC-bash only today — the dashboard uses `pi.exec`) or read pi's bash-tool session env (incl. whether `pi.exec` children inherit `PI_SESSION_*` from the pi process env). Record the outcome in the `bash-execution` spec. Land code ONLY if a concrete applicable path exists; the existing `bash_output` contract stays unchanged either way. (test-plan #M1: manual-only)

## 6. `outputPad` — documented no-op (corrected rationale)

- [ ] 6.1 Record in the `pi-api-feature-detection` spec that `outputPad` is a TUI horizontal-padding setting with no web-client surface (not a renderer API, predates the pin). No code lands. (test-plan #M2: manual-only)

## 7. `"pending"` stop-reason guard (reachability-verified)

- [ ] 7.1 Determine whether `stopReason === "pending"` can reach the terminal `agent_end` message `classifyTurnActionability` runs on (`bridge.ts`), AND which bucket it lands in — note `#7272` converts unmapped terminal reasons to provider errors pi-side, so if `"pending"` only ever appears as a non-terminal/streaming reason (or is error-mapped at terminal), the guard is inert; record the finding either way.
- [ ] 7.2 Where reachable, classify `"pending"` as in-progress/`normal` so a mid-stream partial is not `empty-actionable`, WITHOUT suppressing the `EmptyActionableGuard` for genuinely idle (non-`"pending"`) turns.

## 8. Validation

- [ ] 8.1 `openspec validate update-pi-core-0-83-adopt-apis --strict` passes.
- [ ] 8.2 Full test suite green against resolved `0.83.0`.
- [ ] 8.3 `review-code` pass on the diff; `doubt-driven-review` on the pin fan-out before merge.

## Tests

> Folded from `test-plan.md` (plan-proposal Step 3). Each row = one automated scenario; Triple is `input · trigger · observable`. Manual-only rows (#M1, #M2) are tagged on tasks 5.1/6.1 above, not folded here.

### scopedModels (`role-model-tools`) — exemplar `packages/extension/src/__tests__/role-model-tools.test.ts`

- [ ] T1 Non-empty scope narrows: `getAvailable()`=[x/A,y/B,z/C] + `ctx.scopedModels`=[{model:{provider:x,id:A}}] · `list_models` invoked · rows=[x/A] only, `ref` "x/A" assignable, `registryReady` as before. (test-plan #E1)
- [ ] T2 Present-but-empty scope falls back: getAvailable=[x/A,y/B,z/C] + `ctx.scopedModels`=[] · `list_models` · output byte-identical to absent case (all 3 rows, same order, none dropped). (test-plan #E2)
- [ ] T3 Absent scope falls back: `ctx.scopedModels`=undefined · `list_models` · unfiltered `getAvailable()` output, no throw. (test-plan #E3)
- [ ] T4 Ref derived from Model object: entry `{model:{provider:"anthropic",id:"claude-x"}}` · intersection runs · derived ref `anthropic/claude-x` matches row key, row RETAINED (object-vs-string mismatch would drop it). (test-plan #E4)
- [ ] T5 Capture guarded: `ctx` lacking `scopedModels` · read at `list_models` call time · no throw, unfiltered fallback. (test-plan #X1) — exemplar `packages/extension/src/__tests__/provider-register-reload.test.ts`

### version skew + coherence — exemplars `packages/server/src/__tests__/pi-version-skew.test.ts`, `scripts/__tests__/verify-release-deps-openspec-floor.test.mjs`

- [ ] T6 Recommended bump = hint not block: installed pi `0.81.1`, window {min 0.78.0, rec 0.83.0} · `pi-version-skew.ts` computes · upgrade hint toward `0.83.0`, no hard block. (test-plan #E5)
- [ ] T7 Exactly recommended = no hint: installed pi `0.83.0`, rec `0.83.0` · skew compute · no upgrade banner. (test-plan #E6)
- [ ] T8 Below minimum still gated: installed pi `0.77.0`, min `0.78.0` · skew compute · minimum gate applies unchanged. (test-plan #E7)
- [ ] T9 Coherent pins pass: server dep `^0.83.0` + recommended `0.83.0` + Dockerfile `@0.83.0` · `verify-release-deps.mjs` run · pi coherence check passes, exit 0. (test-plan #E8)
- [ ] T10 Drifted pin fails + names it: server dep `^0.83.0`, recommended `0.82.0` (drift), Dockerfile `@0.83.0` · run · fails, names `piCompatibility.recommended`. (test-plan #E9)
- [ ] T11 Normalization across syntaxes: three pins `^0.83.0`/`0.83.0`/`@0.83.0` (same version) · run · passes, no false-fail. (test-plan #E10)

### TypeBox 1.3.7 — exemplars `packages/extension/src/__tests__/ask-user-tool.test.ts`, CI workflow

- [ ] T12 Removed-API audit: `packages/extension/src` (non-test) · grep `Type.Base|Awaited|Promise|AsyncIterator|Iterator|Options|Value.Mutate` · zero matches. (test-plan #E11, ci)
- [ ] T13 Nullable-array arg absent: `ask-user` args with `options` omitted under typebox `1.3.7` · validate · accepted (unchanged from 1.1.x). (test-plan #E12)
- [ ] T14 Nullable-array arg null: `ask-user` args `options: null` under `1.3.7` · validate · same verdict as pre-bump baseline. (test-plan #E13)
- [ ] T15 Nullable-array arg valid: `ask-user` args `options: ["a","b"]` under `1.3.7` · validate · accepted. (test-plan #E14)
- [ ] T16 Full extension suite green against resolved `0.83.0` + typebox `1.3.7` · CI run · 0 failures. (test-plan #E15, ci)

### "pending" classifier — exemplars `packages/extension/src/__tests__/turn-actionability.test.ts`, `empty-actionable-guard.test.ts`

- [ ] T17 Pending not empty-actionable: `agent_end` assistant msg `stopReason="pending"`, no text/tool, reaching classifier · `classifyTurnActionability` · returns in-progress/`normal`, NOT `empty-actionable`. (test-plan #X2)
- [ ] T18 Idle non-pending still guarded: empty turn stopReason ≠ `"pending"` · classify · `empty-actionable`, guard unchanged. (test-plan #X3)
- [ ] T19 Provider-error still error: turn mapping to provider error (incl. 0.83.0 unmapped-terminal→error) · classify · `error` (precedence). (test-plan #X4)
