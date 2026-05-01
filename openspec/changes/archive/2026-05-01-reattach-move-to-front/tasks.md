## 1. Shared protocol & config

- [x] 1.1 Add optional `registerReason?: "spawn" | "reattach"` to `SessionRegisterMessage` in `packages/shared/src/protocol.ts`. Keep it inside the `ExtensionToServerMessage` union (per AGENTS.md note: union membership must be maintained or esbuild strips switch cases).
- [x] 1.2 Add `reattachPlacement: "preserve" | "streaming-only" | "always"` to the config type in `packages/shared/src/config.ts`. Default `"always"`. Add `parseReattachPlacement(raw): ReattachPlacement` validator; invalid values fall back to `"always"`.
- [x] 1.3 Wire `parseReattachPlacement` into `loadConfig()`; `ensureConfig()` MUST NOT write the field to the on-disk defaults.
- [x] 1.4 Unit tests in `packages/shared/src/__tests__/config.test.ts` covering the four scenarios from the `shared-config` delta (preserve / streaming-only / always / missing-falls-back / invalid-falls-back / ensureConfig-excludes).

## 2. Bridge changes

- [x] 2.1 Add `hasRegisteredOnce: boolean` (default `false`) field to `BridgeContext` in `packages/extension/src/bridge-context.ts`.
- [x] 2.2 In `packages/extension/src/session-sync.ts::sendStateSync`, compute `registerReason = bc.hasRegisteredOnce ? "reattach" : "spawn"` BEFORE building the message; flip `bc.hasRegisteredOnce = true` AFTER `connection.send(...)` resolves.
- [x] 2.3 In `handleSessionChange`, always set `registerReason: "spawn"` on the new-session register (do not consult `hasRegisteredOnce`). Add a comment citing `reattach-move-to-front`.
- [x] 2.4 Unit tests in `packages/extension/src/__tests__/session-sync-register-reason.test.ts` covering: first send → `"spawn"`, second send → `"reattach"`, fork after reattach → `"spawn"` for new id, registry unchanged in any case.

## 3. Server changes

- [x] 3.1 In `packages/server/src/event-wiring.ts::onSessionRegistered`, after the existing pendingAttachRegistry block, read the inbound `session_register` message's `registerReason` (route via the wiring's existing message path — capture the field at the `session_register` switch arm in `event-wiring.ts:303` and forward it into the hook by extending the hook signature OR by stashing on a per-cwd in-memory map keyed by sessionId, depending on which is least invasive). When equal to `"reattach"` AND `pendingResumeIntents.consume(sessionId)` returns `null`, apply the configured `reattachPlacement` policy.
- [x] 3.2 Implement `applyReattachPolicy(sessionId, cwd, policy, sessionManager, sessionOrderManager, browserGateway)` as a pure-ish helper alongside the hook so it's unit-testable: branches on `"preserve"` / `"streaming-only"` (gated on `status === "streaming"`) / `"always"`; on apply, calls `moveToFront` and broadcasts `sessions_reordered`.
- [x] 3.3 Confirm the existing `endedSessionIds` ended→alive branch in `server.ts` is NOT triggered for reattach when the persisted status was already `"active"` — the new policy is the only place handling that case. If a reattach happens for a session that WAS persisted as `"ended"`, the registry intent (`null`) wins via the existing branch and we skip the policy (matches scenario "Registry intent wins over reattach" only when a non-null intent is present).
- [x] 3.4 Unit tests in `packages/server/src/__tests__/reattach-placement.test.ts`:
  - `"always"` × every status → moveToFront + broadcast
  - `"streaming-only"` × `streaming` → moveToFront + broadcast
  - `"streaming-only"` × `active`/`idle`/`ended` → no-op
  - `"preserve"` × any → no-op
  - Legacy bridge (no `registerReason` field) → no-op (backwards compat)
  - Registry intent `"front"` overrides `registerReason: "reattach"` → moveToFront fires once via the registry path, policy is skipped
- [x] 3.5 Add a focused integration test in `packages/server/src/__tests__/session-order-reboot.test.ts` (extend existing) verifying: a session at index 5 of `sessionOrder`, persisted as `"active"`, re-registered with `registerReason: "reattach"` under `reattachPlacement: "always"` → ends up at index 0 + a `sessions_reordered` broadcast lands at every connected browser.

## 4. Settings UI

- [x] 4.1 Add a `reattachPlacement` dropdown to `packages/client/src/components/SettingsPanel.tsx` next to the existing `spawnStrategy` field. Three options with helper-text matching the policy descriptions in `design.md::D2`.
- [x] 4.2 Verify the existing `config-api.ts` partial-merge path passes `reattachPlacement` through (no allowlist change should be required since it's a top-level field, but pin with a one-line test in `config-api.test.ts`).

## 5. Documentation

- [x] 5.1 Update `AGENTS.md`'s entries for `pending-resume-intent-registry.ts`, `event-wiring.ts`, and `session-sync.ts` to reference this change name and the 4-way contract.
- [x] 5.2 Update `docs/architecture.md`'s session lifecycle section with the new reattach branch.
- [x] 5.3 Add a `## [Unreleased]` entry to `CHANGELOG.md` calling out the default-behavior change with the rollback recipe (`reattachPlacement: "preserve"`).
- [x] 5.4 Update README.md config table if it lists fields (otherwise no-op).

## 6. Verification

- [x] 6.1 `npm test 2>&1 | tee /tmp/pi-test.log` — full suite passes (373 files, 3818 passed, 9 skipped, 0 failures).
- [x] 6.2 `npm run build` clean.
- [x] 6.3 Manual smoke verified post-`/api/restart`: a previously-buried session moved to the top of its folder list (`019dd120` from index n>0 to index 0 in `pi-agent-dashboard`'s `sessionOrder`). User can flip `reattachPlacement` to `"preserve"` and restart to confirm the inverse.
- [x] 6.4 `npm run reload` pushed to all connected pi sessions; bridge change live.
