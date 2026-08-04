## Context

The dashboard runs as three coupled components (bridge extension, Node server, React client) against a pi runtime the user may install anywhere and at any version. The server declares a compatibility window (`piCompatibility` in `packages/server/package.json`, read by `pi-version-skew.ts`): `minimum 0.78.0`, `recommended 0.81.1`, `maximum null`. We are moving `recommended` to `0.83.0` and adopting the genuinely-applicable new-in-0.82/0.83 APIs, but the `minimum` MUST stay `0.78.0` — the dashboard is expected to keep running on any pi ≥ minimum. That forces every committed adoption to be **feature-detected at runtime by the concrete surface**, never assumed from the version string.

Upstream `0.83.0` carries a breaking TypeBox 1.3.7 bump (`#7243`). A repo audit shows zero usage of the removed APIs (`Type.Base/Awaited/Promise/AsyncIterator/Iterator/Options`, `Value.Mutate`), so removed-API migration is a verify-not-migrate concern. The live watch item is the same release's **fix to compiled validation of nullable-array tool arguments**, which changes how optional-array tool args validate `null`/missing values.

Two claimed "capabilities" were found on inspection not to apply as-is to this codebase (see Decisions): streaming `bash_execution_update` (no RPC-bash path in the dashboard) and `outputPad` (a TUI padding setting, no web-client surface, predates the current pin).

## Goals / Non-Goals

- Goals: bump the recommended pin across the single-source locations and make `verify-release-deps.mjs` actually enforce their coherence; adopt scoped models with correct empty-scope semantics; add the `"pending"` stop-reason guard (reachability-verified); guarantee graceful degradation on older pi; ensure the extension test suite validates against the runtime TypeBox 1.3.7.
- Non-Goals: raising `minimum` above `0.78.0`; migrating any removed TypeBox API (none used); redesigning the model catalogue, bash card, or renderer registry; committing streaming-bash or `outputPad` code; touching the `@mariozechner/*` legacy fork pins.

## Decisions

- **Feature-detection over version-gating.** Detect capability by the concrete surface, not by comparing the pi version — version strings lie across custom builds and forks. Each committed new path has an explicit `else` that is the current 0.81 behavior verbatim.

- **`scopedModels` narrows via a non-empty check, never empties.** Upstream docs: `ctx.scopedModels` "is **empty** when no scoping is configured, meaning every available model is usable." Each entry is `{ model, thinkingLevel? }`. `list_models` keeps sourcing from `cachedModelRegistry.getAvailable()` (the exact Model-Selector path). The gate is `Array.isArray(ctx.scopedModels) && ctx.scopedModels.length > 0` → intersect `getAvailable()` with the scoped model refs; **absent OR empty → no filter, byte-identical output**. Each scoped entry's `model` is a Model **object**, so the ref is derived as `` `${entry.model.provider}/${entry.model.id}` `` and matched against the tool's existing ref key (`` `${m.provider ?? ""}/${m.id ?? ""}` ``) — a naive object-vs-string intersection would be empty and reintroduce the regression. `ctx.scopedModels` is dynamic (Ctrl+P cycling), so it is read from the live ctx at `list_models` call time, not cached at register. Using presence (`typeof … !== "undefined"`) instead of non-empty length would route every default 0.83.0 session (where the array is present-but-empty) into the constrain branch and yield zero models — a silent catastrophic regression on the new recommended version. The intersection preserves each row's `ref` so refs stay assignable and leaves the `registryReady`/`reason` discriminator untouched. The capture in `provider-register.ts` is guarded so an absent surface never throws.

- **`"pending"` guard is reachability-verified, not blanket.** `classifyTurnActionability` runs on the terminal `agent_end` assistant message (`bridge.ts`), then feeds `EmptyActionableGuard` (which nudges/surfaces on genuinely idle turns). `"pending"` is a partial-**streaming** reason. Step one is to verify whether `"pending"` ever appears on the `agent_end` terminal message (vs only on `message_update`/`message_end`); the guard change is written only for the shapes that actually reach the classifier. Where it does reach, `"pending"` classifies as in-progress so a mid-stream partial is not misread as `empty-actionable`, but the change must NOT suppress the empty-actionable guard for turns that are genuinely idle. `#7272` already converts unmapped terminal provider reasons to errors pi-side, so the classifier no longer sees those as raw terminal strings; error precedence is unchanged.

- **TypeBox: verify removed APIs + close the test/runtime version gap.** Removed-API audit is clean (verify-not-migrate). But the extension's vitest suite resolves the devDep `typebox ^1.1.33` while runtime resolves pi's bundled 1.3.7 via the `"*"` peer, so tests do not exercise the 1.3.7 validator by default. Bump the extension devDep `typebox` to `^1.3.7` (+ lockfile) — a fifth single-source pin — then assert the real risk: optional-array tool args (e.g. `ask-user` `options: Type.Optional(Type.Array(...))`) accept/reject the same `null`/missing/valid argument shapes under 1.3.7 as before. The `ask-user` schema emits a flat `Type.Object` (no root `anyOf`), so the invariant to protect is **validation behavior of the nullable array**, not schema emission shape.

- **Pin coherence is enforced, not asserted.** `verify-release-deps.mjs` currently checks only the server-dep floor. Extend it to also assert `piCompatibility.recommended` and the `docker/Dockerfile` global-install pin resolve to the same **normalized** version as the server dep (the three pins use different syntaxes `^0.83.0` / `0.83.0` / `@0.83.0`, so compare via the existing `floorOf()`-style normalizer, not literal strings). Scope: the **three pi-version pins**; the extension `typebox` devDep is a separate test-fidelity pin and out of scope for this rule.

- **Streaming `bash_execution_update` → feasibility spike (no code committed).** `bash_execution_update` fires only for direct RPC bash commands correlated by request id (`docs/rpc.md`). The dashboard's bash paths are: dashboard-initiated `!`/`!!`/slash-exec → `handleBashCommand` → `pi.exec(...)` → the dashboard's own synthetic `bash_output` event; and LLM tool bash → `tool_execution_*`. Neither is RPC bash, so `bash_execution_update` cannot fire. The spike investigates whether any real path exists during implementation and records the outcome; code lands only if one does.

- **`outputPad` → documented no-op (corrected).** `outputPad` is a TUI horizontal-padding setting (`docs/settings.md`, `#6168`), not a custom-message-renderer API and not new in 0.82/0.83. The dashboard renders in the web client, not pi's TUI, so `outputPad` has no dashboard surface. Recorded as a no-op with the correct rationale; no renderer is introduced.

## Risks / Trade-offs

- **`scopedModels` empty-set regression** → **Mitigation:** gate on non-empty length; test the present-but-empty case explicitly (must be byte-identical to absent).
- **TypeBox nullable-array validation change silently alters `ask-user` arg validation** → **Mitigation:** bump the extension devDep to `^1.3.7` so tests run on the runtime validator; assert accepted/rejected argument shapes for the optional-array field, plus the full extension suite, against 0.83.0.
- **Version pins drift across the five single-source files** → **Mitigation:** extend `verify-release-deps.mjs` to enforce cross-pin coherence (it is itself one of the pins and already gates release).
- **`"pending"` never reaches `agent_end`** → the guard change is inert (harmless) but the task should record the reachability finding so a future reader knows why.
- **Recommended bump raises the effective Node floor** → **Mitigation (follow-up):** `bundled-node-meets-pi-floor.test.ts` keys on `minimum`; add a recommended→Node-floor watch check so a standalone/electron user is not pushed onto a pi their Node cannot run.

## Migration Plan

1. Edit the five pins (server dep, `piCompatibility.recommended`, `verify-release-deps.mjs`, `docker/Dockerfile`, extension devDep `typebox`); refresh lockfile; extend the coherence check.
2. Run the extension test suite against 0.83.0 with the bumped TypeBox (removed-API audit + nullable-array validation + turn-actionability).
3. Land feature-detected adoptions one capability at a time, each with its fallback test: scoped models (incl. empty-scope), `"pending"` guard (reachability-verified).
4. Execute the streaming-bash feasibility spike; record the outcome. Record the `outputPad` no-op.
5. Rollback = revert the pin edits + lockfile; committed adoptions are inert on older pi and can ship independently.

## Resolved Decisions

- **outputPad → documented no-op (kept, corrected rationale).** Not dropped; recorded as a TUI-only padding setting with no web-client surface. No renderer, no code.
- **bash streaming/env → feasibility spike.** Not committed. Investigated during implementation because the dashboard has no RPC-bash path today and the named env consumers (`pi.exec` children, server-side worktreeInit bash) do not receive pi's bash-tool session env.
- **scopedModels detection → non-empty length**, not presence — driven by the upstream empty-when-unscoped semantics.
- **TypeBox verification requires a fifth pin** (extension devDep) so the suite validates against the runtime version.
