## Context

See `proposal.md` § Why for motivation. Design-level state that shapes the approach:

- **The pin is governed in SIX places that must move atomically**, or `scripts/verify-release-deps.mjs` fails the release gate (or, worse, the tree silently ghosts): the server dependency range, `piCompatibility.recommended`, `piCompatibility.minimum`, the `docker/Dockerfile` global install, the checker's own `minVersion` constant (a literal the checker compares against itself), and **`pnpm-workspace.yaml` `overrides["@earendil-works/pi-coding-agent"]` (currently `0.84.4`, line 47)**. The override is not cosmetic: under `nodeLinker: hoisted` the broad `>=0.80.10` peer ranges across eight publishable packages otherwise resolve a second, older hoisted copy, which `/api/health`'s probe reports instead of the server's nested copy — the ghost-version defect `update-pi-core-0-84-adopt-apis` introduced the override to kill. Only the docker harness catches it; no unit test does.
- **`piCompatibility.minimum` is load-bearing in three independent subsystems**, not one: `packages/server/src/pi/pi-version-skew.ts` (`computeCompatibility` sets a hard `error` → red `PiVersionAdvisory` panel; it is an *advisory*, not an HTTP gate — there is no 503 compatibility path in the tree), `pi-runtime-selection` (below-floor candidates are enumerated but unselectable), and the doctor skill's derived `pi-resolution` tables. Raising it changes all three at once.
- **`piCompatibility.minimum` is also a lookup key in a test table.** `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` indexes `PI_MIN_TO_NODE_FLOOR[piMin]` by the *exact* floor string and asserts the row is defined. The table stops at `"0.78.0"`, so raising the floor fails that test even though `engines.node` is unchanged. The row is required by the lookup, not by a Node-floor move.
- **Two kinds of version gate exist in the tree.** One is a *runtime feature-detection* gate (probe the surface, fall back) — the pattern `pi-api-feature-detection` mandates. The other is a *version-string* gate — `agent-settled.ts`'s `NATIVE_AGENT_SETTLED_FLOOR = "0.80.4"` with a hand-rolled `parseVersion()`. The spec already forbids the second pattern; the lockstep floor is what finally makes removing it possible rather than merely desirable.
- **Some pi surfaces the dashboard depends on are not exported and cannot fail at build time.** The resource-activation write path and `SessionManager.inMemory()` reach runtime internals. A green `npm test` with mocked catalog probes is not evidence for these; the 0.84 change recorded this as its largest unknown and it recurs here unchanged.

## Goals / Non-Goals

**Goals:**

- Land the pin at `0.85.1` with all governed surfaces coherent, in one commit, so no intermediate state fails the release gate.
- Convert the lockstep floor from a version-literal edit into a *stated policy* in `pi-core-version-check`, so a future change cannot quietly re-diverge `minimum` from `recommended`.
- Delete the version-string gates the floor makes unreachable, rather than leaving them as dead branches — including the latent major-first comparator defect.
- Verify, at runtime and not by inspection, the pi surfaces that fail only at runtime.
- Make the pinned version a *derived* value in tests and derived docs, so the next bump touches the pin surfaces only.

**Non-Goals:**

- Any change to `OAUTH_INCOMPATIBLE`. The fable 5.1 failure was a client-version header gate, not a catalog gate; the spec now says so explicitly so a later change does not "fix" it there.
- A provider-key remap for GPT-6 Astra. Resolved as unnecessary — see Decision 5.
- Adopting any newly published runtime subpath (`./experimental/plugin`, `./client`, `/rpc-entry`). The dashboard imports the root specifier only and that stays true.
- Cutting a dashboard release. That is `release-cut`.
- A deprecation window or dual-floor transition for below-floor users. See Decision 2.

## Decisions

### 1. Target `0.85.1`, never `0.85.0`

`0.85.0` unintentionally published internal experimental code and dependencies, breaking SDK imports ([pi#9132](https://github.com/earendil-works/pi/issues/9132)); `0.85.1` reverts it and restores the `./client` compatibility entry point. Landing on `0.85.0` would ship a known-broken import surface for downstream consumers of our own packages.

*Alternative considered:* pin `^0.85.0` and let the range float to `0.85.1`. Rejected — the range floor is what `verify-release-deps.mjs` normalizes and compares, and a `0.85.0` floor would let a fresh install resolve the broken version.

### 2. Lockstep floor, with a hard break and no deprecation window

`minimum` moves to `0.85.1` together with `recommended`. Users on `0.78.x`–`0.84.x` flip from working to hard-blocked in one release.

*Rationale.* The broad floor's cost was never the support matrix — it was that **the fallback branches it justified were untestable**. CI runs against the pinned runtime only, so every "below floor" branch in the tree was dead code that nobody could execute. `agent-settled.ts` proves the point concretely: its comparator evaluates the major component first and returns "supported" for any major ≥ 1, so on a future pi `1.x` the gate would have silently mis-answered — a live defect that sat in a branch no test could reach. A floor that guarantees exactly one supported runtime removes the branch class, not just the branches.

*Alternatives considered.*
- *Keep the broad floor, add tests against an old pi.* Rejected: requires installing and spawning multiple pi versions in CI, and the surfaces that actually break are runtime-internal — the matrix would grow faster than the coverage.
- *Two-step: raise `minimum` to `0.84.4` now, lockstep later.* Rejected: it still hard-breaks users (0.78–0.83) while leaving the `0.80.4` gate reachable, so it pays the cost of the break without buying the simplification.
- *Soft floor — warn below `minimum` instead of blocking.* Rejected: it contradicts the existing `pi-runtime-selection` requirement that below-floor candidates are unselectable, and it re-creates the untestable-branch problem under a different name.

*Mitigation is communication, not code:* a `CHANGELOG.md` callout and the existing red advisory panel, which the spec now requires to name `0.85.1` explicitly rather than saying "below minimum".

### 3. Retire `agent-settled.ts` wholesale, not just its gate

The floor makes `nativeAgentSettledSupported()` constant-true, so everything the module exports becomes unreachable. Delete the module and its test with it, rather than simplifying the gate to `return true`.

*The removal surface is larger than the gate — enumerate it before touching code.* The module exports **nine** symbols, not four: `NATIVE_AGENT_SETTLED_FLOOR`, `FLOOR_RETRY_UNKNOWN_DELAY_MS`, `FLOOR_RETRY_GRACE_MS`, `floorRetryReconcileDelay`, `nativeAgentSettledSupported`, `interface SettleEvent`, `synthesizeAgentSettledEvent`, `markFloorSettle`, `settleFollowUp` (plus the private `parseVersion`). `bridge.ts` consumes five of them across **three** sites, not one — and `packages/extension/src/__tests__/retry-tracker.test.ts:2` imports `settleFollowUp` as a **second consumer outside `bridge.ts`**:

| site | what it is |
|---|---|
| `bridge.ts:24` | the import |
| `bridge.ts:354-357` | `piEmitsNativeSettled` read at activation |
| `bridge.ts:2097, 2152` | `floorRetryWaiting` declaration + assignment from `auto_retry_waiting` |
| `bridge.ts:2518-2557` | the floor-retry reconciliation machine: `markFloorSettle(…, false)`, a `setTimeout(…, floorRetryReconcileDelay(delay))` that converges a terminal settle, and its `retryTracker`/`abortLatch` interplay |

The 2518-2557 block is nested inside `if (synthSettle)`, and `settleFollowUp` returns `null` whenever `nativeSupported` is true — so the block is *entirely* unreachable once the floor guarantees native settles. `floorRetryWaiting` is subtler: its **assignment** at `:2152` sits in live native-pi code (the `auto_retry_waiting` arm of the `agent_end` handler), so it is a dead *store* in reachable code rather than unreachable code. Removing it is still safe — its only reader is the unreachable block — but it must be recognised as an edit to a live handler, not a block deletion. "Single consumer at `:356`" understates the whole surface by ~45 lines; an implementer following that description literally hits unlisted code and a broken build.

*Client-side tail.* `markFloorSettle` is the **only** producer of `agent_settled` with `data.retryPending === true`, and `packages/client/src/lib/chat/event-reducer.ts:1442` branches on exactly that flag (covered by `event-reducer-agent-settled.test.ts:94,110`). Once the producer is gone the reducer branch is unreachable — the same dead-fallback class this change's own `pi-api-feature-detection` delta obliges us to remove. Retire the branch and its two test cases with the producer, in this change, or the change violates the policy it writes.

*Residual behavior change (accepted).* `nativeAgentSettledSupported` returns `false` for an **unknown/unparseable** pi version — today that synthesizes defensively. After removal, an unknown-version pi is trusted to emit natively. `pi-runtime-selection` deliberately exempts unknown-version candidates from the floor, so such a runtime can still be selected. Accepted: an unknown-version pi is already outside every other guarantee this change makes, and the alternative (keep the module for one unparseable-version case) reintroduces the untestable branch class the floor exists to remove.

*Alternative considered:* keep the module with the gate stubbed to `true`, "in case the floor drops again". Rejected — the spec's new lockstep requirement makes a floor drop a spec violation, so the defensive code guards a state that can no longer exist. A stub also preserves the misleading name.

*Consequence for the spec:* `bridge-extension`'s `agent_settled` requirement is a MODIFIED block, not a REMOVED one — the bridge still forwards the native event; only the synthesis half is withdrawn.

### 4. Comment corrections are behavior-free and must stay that way

`bridge.ts`'s `passThroughEventTypes` and `event-status-extraction.ts` carry "inert below floor" comments for `session_compact_failed` (≥ 0.84.3) and `ui_prompt_start`/`ui_prompt_end` (≥ 0.84.4). Subscribing was already unconditional, so these are stale prose, not gates. Correct the comments; assert no diff in behavior.

*Trap to avoid:* treating the stale comment as a signal that a gate exists and "removing" it by changing the subscription list. Nothing in the subscription list changes.

### 5. GPT-6 Astra needs no provider-key remap — verified, not assumed

The proposal originally raised this as an open design question, on the reasoning that `internal-auth-storage.ts:34` maps the `openai-codex` auth key while pi-ai models carry provider `openai`, so a Codex credential would not be found for an `openai` model.

**Inspection of the 0.85.1 catalog refutes the premise.** `gpt-6-astra` is published four times, once per channel, each entry carrying its own `provider`: `openai` (api `openai-responses`), `openai-codex`, `github-copilot`, and `azure-openai-responses`. The Codex channel is a first-class catalog entry keyed `openai-codex` — exactly the key the auth map and the credential filter already use. The filter matches on equality and finds it.

*Decision:* add no mapping. Pin the conclusion in `model-proxy-credential-routing` as a requirement, including the prohibition on prefix/substring provider matching, so a future change does not "fix" a non-problem with a heuristic that would over-grant credentials across providers. Verification is a catalog assertion, not a live API call.

*Alternative considered:* add a defensive `openai-codex → openai` mapping anyway. Rejected — it would make a Codex subscription credential appear able to route every `openai`-provider model including ones the subscription does not authorize, i.e. it widens credential scope to solve nothing.

### 6. Derive the pinned version in tests instead of restating it

`tests/e2e/pi-084-runtime.spec.ts` hardcodes `PINNED_PI = "0.84.4"` and encodes the version in its filename. Read the pin from `packages/server/package.json` at test time and rename the spec version-neutrally.

`tests/e2e/pi-084-runtime.spec.ts:90` also hardcodes `expect(compat.minimum).toBe("0.78.0")`. Parameterizing `PINNED_PI` alone leaves that assertion failing under lockstep — derive the floor from the same `packages/server/package.json` read.

`packages/server/src/__tests__/pi-version-skew.test.ts` is the deliberate exception: it asserts the *multi-surface coherence* of the literals, so it must keep literals or it would assert a tautology (comparing a value to itself). Update its literals by hand; keep them literal. Its `checkPiPinCoherence` fixture (`:60-66`) passes a synthetic `serverPkg` carrying only `dependencies` + `piCompatibility.recommended`; extending the checker to require `minimum` (and the workspace override) breaks that fixture unless it is updated in the same task.

`packages/server/src/__tests__/pi-version-skew-recommended-0-84.test.ts` is NOT updated and NOT deleted: it exercises `computeCompatibility` with a **synthetic** range (`{minimum: "0.78.0", recommended: "0.84.1"}`) to cover the hint-vs-block boundary. The function stays range-parameterized, so the test remains valid and is the only coverage of the hint branch once the shipped band is empty.

*This is the general rule the change installs:* a test that asserts "the pin is coherent" holds literals; a test that merely *needs* the pinned version derives it.

### 7. Runtime verification is a first-class task, not a test run

For `SessionManager.inMemory()`, the resource-activation write path, and the trust symbols (`ProjectTrustStore`, `hasTrustRequiringProjectResources`), a green unit suite is not evidence — the consumers reach unexported internals and mocked probes pass regardless. Each gets an explicit runtime check: spawn a real dashboard session, exercise the draft-agent path, and toggle a resource, recording the observed result.

Specifically re-verify the four properties the 0.84 change enumerated: directory layout (`~/.pi/agent`, the `skills|extensions|prompts|themes` roots, the `<agentDir>/npm/node_modules/<name>` install root); pattern-matching semantics (`matchesAnyPattern` vs `matchesAnyExactPattern`, and the excludes → force-includes → force-excludes precedence); package-identity normalisation (`getPackageIdentity`); and delta resolution (`findAutoloadDeltaBase` engaging only for `scope === "project" && autoload === false`).

### 8. Abort-cancels-compaction is a latch-stranding audit, not a feature

`abort` previously reported success without cancelling a manual compaction; at `0.85.1` it genuinely cancels. The dashboard's `compacting` latch is cleared in `event-status-extraction.ts:100-108` by `session_compact` (success) or `session_compact_failed` (failure) — neither of which the abort path is guaranteed to emit now that abort genuinely cancels. The audit question is therefore narrow and answerable: does an aborted compaction leave the latch set? If yes, clear it on the abort path too.

*Alternative considered:* add a timeout that clears the latch defensively. Rejected — it hides the state machine bug and would clear the latch on a slow-but-succeeding compaction.

### 9. Publishable peer ranges stay broad; the floor does not propagate to npm consumers

Eight publishable packages (`packages/extension`, `context-budget`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`) declare `@earendil-works/pi-coding-agent >=0.80.10` as a peer. These are **not** raised to `0.85.1`.

*Rationale.* The peer range describes what the published package supports for its own npm consumers — a pi user installing the bridge extension standalone, with no dashboard. `piCompatibility.minimum` governs what the *dashboard server* will drive. Conflating them would break standalone installs for a constraint that does not apply to them. Retiring the `agent_settled` synthesis does not invalidate `>=0.80.10` either: pi emits `agent_settled` natively from `0.80.4`, strictly below that peer floor.

*Consequence:* the coherence checker deliberately ignores peer ranges, and the spec records them as out of the governed set so a later change does not "fix" the apparent inconsistency. It also means the `pnpm-workspace.yaml` override stays permanently necessary (Context, bullet 1) — the broad ranges are exactly what it exists to collapse.

### 10. A persisted runtime override below the new floor is out of scope

`pi-runtime-selection` makes below-floor candidates unselectable in the picker, but a **previously persisted** override pointing at a 0.78–0.84 install is not re-validated at spawn (`spawn-preflight.ts` has no floor check), and already-running sessions are untouched.

*Decision:* do not add override invalidation in this change. The user-visible signal is already correct — the red advisory names `0.85.1` and the picker refuses the stale install on next use — and adding a spawn-time floor gate is a behavior change to the selection subsystem that belongs in `pi-runtime-selection` with its own scenarios. Recorded here so the gap is deliberate rather than discovered.

## Risks / Trade-offs

- **[Every 0.78–0.84 user is hard-blocked on upgrade]** → Accepted deliberately (Decision 2). Mitigated by a `CHANGELOG.md` callout and an advisory panel that names `0.85.1` and the upgrade action, which the spec now requires. Rollback is a revert of the pin commit, which restores the old floor in the same motion.
- **[A runtime-internal pi symbol moved and nothing fails until a user hits it]** → Decision 7's explicit runtime checks. This is the change's largest residual unknown and the reason `systematic-debugging` is named in the proposal's Discipline Skills.
- **[Deleting `agent-settled.ts` removes coverage of the terminal-signal contract]** → The contract itself is unchanged and still covered: the bridge must emit exactly one `agent_settled` per run. Keep a test for *that*, sourced from the native event; retire only the synthesis-specific cases.
- **[The coherence check passes while an ungoverned literal drifts]** → Both previously-ungoverned literals — the checker's own `minVersion` and the `pnpm-workspace.yaml` override — are now in the governed set and the spec requires all six to be equal, so a drift fails the gate rather than surfacing as a ghost version at runtime.
- **[A stale `pnpm-workspace.yaml` override silently ghosts the bump]** → The most dangerous single omission in this change: leaving `overrides` at `0.84.4` while every other pin says `0.85.1` resolves an old hoisted copy that `/api/health` reports, so the dashboard claims a version it is not running — and the fable 5.1 fix appears not to work. Caught by the harness E2E and by the extended coherence gate, never by `npm test`.
- **[The main-spec scenario pre-renames look like an unexplained drive-by edit]** → `openspec` refuses a MODIFIED block that drops a scenario the main spec still has, and several scenarios here are genuinely obsolete (`Floor is not raised by a runtime pin bump` directly contradicts this change). The sanctioned procedure is to pre-rename the `#### Scenario:` heading in the main spec so the name sets match; archive then replaces the whole block. The renames are recorded in `tasks.md` so the commit explains them.
- **[Comment-only edits get bundled with behavior edits and hide a real change]** → Decision 4 keeps them behavior-free; review them as a separate hunk.

## Migration Plan

1. **Pin bump, atomic.** Move all five governed literals plus `piCompatibility.minimum` in one commit, then `pnpm install` (never `npm install` — `pnpm-workspace.yaml` sets `nodeLinker: hoisted`). `verify-release-deps.mjs` is the gate that proves atomicity.
2. **Dead-gate removal.** Retire `agent-settled.ts` + its consumer + its test. Correct the stale pass-through comments.
3. **Audits.** `ctx.cwd` across dashboard-registered tools; abort/compaction latch; `SessionManager.inMemory()`; thinking-effort double-handling.
4. **Runtime verification** (Decision 7) — before, not after, the docs step, because a failure here changes the tasks.
5. **Derived surfaces.** Regenerate the doctor `pi-resolution` module (`doctor --regenerate pi-resolution`); never hand-edit. Update `docker/AGENTS.md` and `CHANGELOG.md`.

**Rollback:** revert the pin commit. Because the floor, the pin and the Dockerfile move together, the revert restores a coherent below-floor-tolerant state with no partial-state window. The dead-gate removal is *not* independently revertible in a useful way — reverting only step 2 would restore a gate that the (still-raised) floor makes unreachable — so steps 1 and 2 revert together or not at all.
