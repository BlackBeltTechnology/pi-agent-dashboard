## 1. Version bump (single-source pins)

- [ ] 1.1 `packages/server/package.json`: dep `@earendil-works/pi-coding-agent` `^0.81.1 → ^0.83.0`.
- [ ] 1.2 `packages/server/package.json`: `piCompatibility.recommended 0.81.1 → 0.83.0` (leave `minimum: 0.78.0`, `maximum: null`).
- [ ] 1.3 `scripts/verify-release-deps.mjs`: `minVersion 0.81.1 → 0.83.0` and update the descriptive rationale string.
- [ ] 1.4 `docker/Dockerfile`: global install pin `@earendil-works/pi-coding-agent@0.81.1 → @0.83.0`.
- [ ] 1.5 Refresh `pnpm-lock.yaml`; confirm the electron bundle (`bundle-server.mjs`) resolves the server's `^0.83.0` — no independent electron pin to edit.
- [ ] 1.6 DocScribe: update the pinned-version row in `docker/AGENTS.md` (caveman style).

## 2. TypeBox 1.3.7 breaking-change verification (verify, not migrate)

- [ ] 2.1 Re-audit `packages/extension/src` for removed APIs (`Type.Base/Awaited/Promise/AsyncIterator/Iterator/Options`, `Value.Mutate`) — expect zero.
- [ ] 2.2 Run `ask-user-schema-discriminator.test.ts` against resolved `0.83.0`; assert `anyOf` discriminated-union emission is unchanged by the nullable-array validation fix.
- [ ] 2.3 Run the full extension vitest suite against `0.83.0`; fix any schema/validation regressions surfaced.

## 3. Adopt `ctx.scopedModels` (scope-aware `list_models`)

- [ ] 3.1 Capture `ctx.scopedModels` where the extension already captures `ctx.modelRegistry`/`ctx.model` (`provider-register.ts`), guarded by presence.
- [ ] 3.2 In `role-model-tools.ts`, when scoped models are present, intersect the `getAvailable()` catalogue with the scope; preserve `ref` shape and the `registryReady`/`reason` discriminator.
- [ ] 3.3 Fallback test: with `ctx.scopedModels` absent, `list_models` output is byte-identical to today.
- [ ] 3.4 Scoped test: with a scope set, only in-scope `ref`s are returned and each stays assignable via `update_roles`.

## 4. Adopt bash session env + streaming `bash_execution_update`

- [ ] 4.1 In BOTH consumers — factory bash tools AND worktreeInit-style hooks — read `PI_SESSION_ID`/`PI_SESSION_FILE`/`PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL` as optional (absent on older pi).
- [ ] 4.2 Subscribe the bridge to `bash_execution_update`; forward incremental chunks as a new streaming signal keyed to the command.
- [ ] 4.3 Preserve the terminal `bash_output` card contract; client coalesces chunks into the existing card.
- [ ] 4.4 Fallback test: on a pi without `bash_execution_update`, only the terminal `bash_output` card renders (no error, no missing output).
- [ ] 4.5 Streaming test: chunks arrive incrementally and coalesce into the same final card content.

## 5. `outputPad` — documented no-op (decided: no renderer)

- [ ] 5.1 Confirm no pi custom message renderer is registered by the extension; record the no-op outcome in the spec. No code lands.

## 6. `"pending"` stop-reason guard

- [ ] 6.1 In `turn-actionability.ts`, classify `stopReason === "pending"` as `normal` (in-progress), above the `empty-actionable` fallthrough.
- [ ] 6.2 Test: a partial turn with `"pending"` and no content is `normal`, not `empty-actionable`.
- [ ] 6.3 Test: newly-raw provider terminal error reasons still classify as `error`.

## 7. Validation

- [ ] 7.1 `openspec validate update-pi-core-0-83-adopt-apis --strict` passes.
- [ ] 7.2 Full test suite green against resolved `0.83.0`.
- [ ] 7.3 `review-code` pass on the diff; `doubt-driven-review` on the pin fan-out before merge.
