## Why

The dashboard pins `@earendil-works/pi-coding-agent@^0.81.1` (server dep + `piCompatibility.recommended`), and the same `0.81.1` is baked into `docker/Dockerfile`, `scripts/verify-release-deps.mjs`, and the electron server bundle. Upstream is now `0.83.0` (0.82.0 → 0.82.1 → 0.83.0), which ships four capabilities the dashboard can adopt — `ctx.scopedModels`, bash-tool session env vars (`PI_SESSION_ID`/`PI_SESSION_FILE`/`PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL`), streaming `bash_execution_update` RPC events, and `outputPad` for custom message renderers — plus a **breaking** TypeBox 1.3.7 bump and a `"pending"` streaming stop reason that our turn-actionability classifier must not misread.

We want to move the recommended pin to `0.83.0` across every published (dist) package and the electron app, adopt the four new APIs, and do all of it behind runtime feature-detection so a session running on an older pi (down to the unchanged `minimum: 0.78.0`) keeps working the old way with no crash and no behavior regression.

## What Changes

- **Version bump (single-source pins only).** `packages/server/package.json` dep `^0.81.1 → ^0.83.0` and `piCompatibility.recommended 0.81.1 → 0.83.0` (`minimum` stays `0.78.0`, `maximum` stays `null`). `scripts/verify-release-deps.mjs` `minVersion` + descriptive string. `docker/Dockerfile` global install pin. All other workspace packages keep their `"*"` peer on pi — no change needed. The electron app inherits the bump through the bundled server (`packages/electron/scripts/bundle-server.mjs`); its offline pi resolves to the server's `^0.83.0`.
- **BREAKING (upstream) — TypeBox 1.3.7 compatibility.** Verify the extension's TypeBox schemas (`ask-user-tool.ts`, `canvas-tool.ts`, `role-model-tools.ts`) still compile and validate under 1.3.7 (removed `Type.Base/Awaited/Promise/AsyncIterator/Iterator/Options`, `Value.Mutate`; audit already shows **zero** usage) and that the nullable-array tool-arg validation fix does not change `ask-user` discriminated-union emission. This is a test/verify task, not a code migration.
- **Adopt `ctx.scopedModels`.** `list_models` gains scope-awareness: when `ctx.scopedModels` is present it constrains the catalogue to the session's resolved scope; when absent (older pi) it falls back to today's `cachedModelRegistry.getAvailable()` path unchanged.
- **Adopt bash session env (both consumers).** BOTH dashboard-side bash paths — factory bash tools AND worktreeInit-style hooks — read `PI_SESSION_ID`/`PI_SESSION_FILE`/`PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL` for correlation, treating each as optional/absent on older pi.
- **Adopt streaming `bash_execution_update` RPC.** The bridge subscribes to `bash_execution_update` and forwards incremental chunks so the web client can stream bash output live; on older pi (no such event) it degrades to the existing terminal-only `bash_output` card.
- **`outputPad` — no-op (decided).** The dashboard will NOT register a pi-TUI custom message renderer (web-client rendering stays the only surface), so `outputPad` adoption is satisfied as a documented no-op. No renderer is introduced and no code lands for it.
- **Guard the `"pending"` stop reason.** `turn-actionability.ts` classifies `"pending"` (0.83.0 partial-streaming) as `normal` (in-progress), so a mid-stream partial is never misclassified as `empty-actionable`; re-confirm newly-raw provider terminal reasons still hit the `error` branch.

## Impact

- Affected specs: `pi-core-version-check` (MODIFIED), `agent-role-model-tools` (MODIFIED), `bash-execution` (MODIFIED), `pi-api-feature-detection` (ADDED — cross-cutting fallback + `outputPad` + bash session env governance).
- Affected code: `packages/server/package.json`, `scripts/verify-release-deps.mjs`, `docker/Dockerfile`, `packages/extension/src/role-model-tools.ts`, `packages/extension/src/turn-actionability.ts`, `packages/extension/src/bridge.ts` (bash streaming forward), `packages/extension/src/provider-register.ts` (scoped-models capture). Docs: `docker/AGENTS.md` version row (DocScribe).
- Compatibility / rollback: every adoption is feature-detected — `minimum` stays `0.78.0`, so sessions on `< 0.83.0` keep the pre-0.83 code path. Rollback = revert the four pin edits + lockfile; no data migration, no protocol break.

## Discipline Skills

- `doubt-driven-review` — the pin bump fans out to every published `@blackbelt-technology/*` package and the electron bundle; stress-test before it stands.
- `observability-instrumentation` — the new streaming `bash_execution_update` forward is a new runtime event path.
- `review-code` — non-trivial multi-file change with backward-compat branches.
