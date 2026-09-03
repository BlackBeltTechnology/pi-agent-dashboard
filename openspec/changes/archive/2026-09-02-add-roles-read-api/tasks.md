## 1. Shared role-schema core

- [x] 1.1 Create `packages/shared/src/role-schema.ts` exporting `RoleConfig` / `RolePreset` types, `DEFAULT_ROLE_NAMES`, `effectiveRoleNames`, `overlayRoles`, `splitRef` / `joinRef`, and `parseRoleConfig`; verify the module imports cleanly in a browser-targeted context by asserting it has no `node:fs` import (the client bundles it)
- [x] 1.2 Move `DEFAULT_ROLE_NAMES`, `effectiveRoleNames`, `overlayRoles` and the ref/level split out of `packages/extension/src/role-manager.ts` verbatim into `role-schema.ts`; verify by diffing the moved function bodies against the originals so the move is provably behaviour-preserving
- [x] 1.3 Implement `parseRoleConfig(raw: unknown): RoleConfig` as a total normalizer — discard non-string/empty role values and trim survivors, discard preset entries that are not objects with a string `name` and object `roles`, collapse duplicate preset names first-wins, coerce a non-string `activePreset` to null; verify it returns a well-formed config for every malformed input in task 5.5 rather than throwing
- [x] 1.4 Correct `overlayRoles` so a removal marker excludes a role name even when an assignment exists for it (today the trailing `{ ...out, ...cfg.roles }` spread reintroduces it); verify with the collision case in task 5.4
- [x] 1.5 Add a purpose row for `role-schema.ts` to `packages/shared/src/AGENTS.md`; verify with `kb dox lint` reporting no missing row for the new file

## 2. Extension repoint (behaviour-preserving)

- [x] 2.1 Repoint `packages/extension/src/role-manager.ts` at the shared helpers and have `loadRoleConfig` delegate normalization to `parseRoleConfig` while keeping its own file read; verify the existing extension test suite passes unchanged
- [x] 2.2 Confirm `role-manager.ts` remains the sole writer of the role slice (`roles`, `rolePresets`, `activePreset`, `roleNames`, `removedRoles`) and that no write path is added elsewhere; verify by grepping for writes to those keys outside the module and finding none
- [x] 2.3 Update the `role-manager.ts` purpose row in `packages/extension/src/AGENTS.md` to record the shared-helper dependency; verify the row renders in `kb agents packages/extension/src/role-manager.ts`

## 3. roles-plugin package wiring

- [x] 3.1 Add `"server": "./src/server/index.ts"` to the `pi-dashboard-plugin` manifest in `packages/roles-plugin/package.json`; verify the plugin loader reports the server entry as loaded rather than missing
- [x] 3.2 Add the `"./server"` entry to `exports` and `fastify: ^5.0.0` to both `peerDependencies` and `devDependencies` in `packages/roles-plugin/package.json`, matching `packages/kb-plugin/package.json`; verify `pnpm install` succeeds and the package typechecks
- [x] 3.3 Create `packages/roles-plugin/src/server/index.ts` mounting the route synchronously on `ctx.fastify` during plugin registration (the host owns `listen`), copying the entry shape from `packages/kb-plugin/src/server/index.ts`; verify the route responds once the dashboard server is up
- [x] 3.4 Scaffold `packages/roles-plugin/src/server/AGENTS.md` via `kb dox init` and add purpose rows for `index.ts` and `roles-routes.ts`; verify `kb dox lint` passes for the new directory

## 4. Route implementation

- [x] 4.1 Create `packages/roles-plugin/src/server/roles-routes.ts` exporting `mountRolesRoutes(fastify, deps)` registering `GET /api/roles` without a `networkGuard` preHandler, mirroring the registration posture of `registerModelsIntrospectionRoute`; verify an unauthenticated-but-dashboard-authorized request returns 200
- [x] 4.2 Implement the canonical axis — `effectiveRoleNames(cfg)` ∪ preset keys, minus removal markers, ordered defaults → user-added → preset-only (preset-only in first-referencing-preset order); verify with the ordering assertions in task 6.6
- [x] 4.3 Implement group projection — live group first with `preset: null`, then preset groups in stored order, each carrying `active`, with dangling-`activePreset` falling back to the live group and duplicate names collapsed; verify exactly one group reports `active: true` across the cases in tasks 6.7–6.9
- [x] 4.4 Implement row projection building each row field-by-field (never by spreading the parsed config), emitting `ref` always (null when unassigned), and omitting `model` / `provider` / `thinkingLevel` when undeterminable; verify with tasks 6.1–6.5
- [x] 4.5 Wrap the config read so every failure mode — missing file, unparseable JSON, permission denied, path-is-a-directory, removal between check and read — degrades to "no assignments" instead of propagating; verify with the fault-injection tasks 7.1–7.4

## 5. Tests — shared core (L1)

- [x] 5.1 Author the axis-construction test in `packages/shared/src/__tests__/role-schema.test.ts`, copying harness glue from a sibling in `packages/shared/src/__tests__/`; input: config with defaults, `roleNames`, assigned keys and `removedRoles` · trigger: `effectiveRoleNames` · observable: union minus removals, canonical order stable across calls (test-plan #E18)
- [x] 5.2 Author the built-in classification test (see `packages/shared/src/__tests__/`); input: config with a user-added role alongside built-ins · trigger: classify each axis name · observable: every canonical default reports builtin true, the user-added reports false (test-plan #E9)
- [x] 5.3 Author the new-built-in propagation test (see `packages/shared/src/__tests__/`); input: a name added to the canonical default set · trigger: overlay a config lacking it · observable: present, builtin true, unassigned, no consumer constant changed (test-plan #E10)
- [x] 5.4 Author the removal-beats-assignment test (see `packages/shared/src/__tests__/`); input: `removedRoles: ["vision"]` and `roles.vision = "x/y"` · trigger: `overlayRoles` · observable: `vision` absent, config unmodified (test-plan #E6)
- [x] 5.5 Author the `parseRoleConfig` totality test (see `packages/shared/src/__tests__/`); input: `rolePresets: [null]`, `[{name:"x",roles:null}]`, `roles:{a:42}`, `roles:{b:"  "}` · trigger: `parseRoleConfig` · observable: invalid entries discarded, well-formed retained, no throw (test-plan #E15)
- [x] 5.6 Author the duplicate-preset-name test (see `packages/shared/src/__tests__/`); input: two stored presets sharing a name with differing assignments · trigger: `parseRoleConfig` · observable: one preset retained, carrying the FIRST entry's assignments (test-plan #E11)

## 6. Tests — route projection (L1)

- [x] 6.1 Author the unassigned-row test in `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`, copying Fastify-inject harness glue from `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`; input: config assigning `coding` but not `vision` · trigger: GET /api/roles · observable: `vision` row has `ref: null`, `assigned: false`, no `model`/`provider`/`thinkingLevel` (test-plan #E1)
- [x] 6.2 Author the full-decomposition test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: `planning = "anthropic/claude-opus-4-8:high"` · trigger: GET /api/roles · observable: ref verbatim plus model, provider, thinkingLevel, assigned true (test-plan #E2)
- [x] 6.3 Author the legacy bare-id test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: role assigned bare id `"deepseek-v4-flash"` · trigger: GET /api/roles · observable: `provider` omitted, model equals stored value, ref verbatim, config unmodified (test-plan #E3)
- [x] 6.4 Author the multi-colon split test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: ref `"a/b:high:low"` · trigger: GET /api/roles · observable: thinkingLevel `"low"`, model `"a/b:high"`, ref verbatim (test-plan #E4)
- [x] 6.5 Author the degenerate-ref test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: refs `"a/b:"`, `":high"`, `"anthropic/"`, `"a/b"` · trigger: GET /api/roles · observable: 200, ref verbatim each, undeterminable parts omitted not empty, no throw (test-plan #E5)
- [x] 6.6 Author the axis-and-group ordering test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: config with defaults, a user-added role, a preset-only role and two presets · trigger: GET /api/roles twice · observable: defaults precede user-added precede preset-only, `data[0]` is the live group then presets in stored order, both responses identical (test-plan #E8)
- [x] 6.7 Author the dangling-activePreset test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: `activePreset: "ghost"` matching no preset · trigger: GET /api/roles · observable: live group active, no preset group active, exactly one active, config unmodified (test-plan #E12)
- [x] 6.8 Author the no-presets test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: `rolePresets: []` · trigger: GET /api/roles · observable: `data` has exactly one element with `preset: null` and `active: true` (test-plan #E13)
- [x] 6.9 Author the active-preset-flagged test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: `activePreset: "cheap"` with presets `cheap` and `max` · trigger: GET /api/roles · observable: `cheap` group active, no other group active (test-plan #E14)
- [x] 6.10 Author the preset-only-name test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: a preset referencing `review` absent from the live config · trigger: GET /api/roles · observable: `review` in every group, live group reports `ref: null` (test-plan #E7)
- [x] 6.11 Author the read-only test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: config with assignments and presets · trigger: GET /api/roles three times · observable: config byte-identical before/after, all three responses identical (test-plan #E16)
- [x] 6.12 Author the fresh-install test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: no config file on disk · trigger: GET /api/roles · observable: 200, one row per canonical default all `ref: null`, file NOT created (test-plan #E17)

## 7. Tests — failure modes and security (L1)

- [x] 7.1 Author the unparseable-JSON test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: config file containing invalid JSON · trigger: GET /api/roles · observable: 200 with every canonical default at `ref: null` (test-plan #X1)
- [x] 7.2 Author the permission-denied test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: config read fails with EACCES · trigger: GET /api/roles · observable: 200, built-ins unassigned, no unhandled error escapes (test-plan #X2)
- [x] 7.3 Author the path-is-a-directory test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: config path resolves to a directory · trigger: GET /api/roles · observable: 200, built-ins unassigned, no unhandled error (test-plan #X3)
- [x] 7.4 Author the TOCTOU test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: file removed between existence check and read · trigger: GET /api/roles · observable: 200, built-ins unassigned, no unhandled error (test-plan #X4)
- [x] 7.5 Author the credential-exclusion test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: a recognisable secret planted in a non-role sibling key of the same file · trigger: GET /api/roles · observable: that secret string absent from the fully serialized response body (test-plan #X5)
- [x] 7.6 Author the plugin-unloaded test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: roles plugin server entry not mounted · trigger: GET /api/roles · observable: 404, no role data served from any other path (test-plan #X6)
- [x] 7.7 Author the auth-gate test (see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`); input: request without dashboard authentication · trigger: GET /api/roles and GET /api/models · observable: identical auth-gate rejection for both, asserted by comparison rather than a hardcoded status (test-plan #X7)

## 8. Tests — cross-surface and regression (L1)

- [x] 8.1 Author the cross-surface agreement test in `packages/shared/src/__tests__/`, copying glue from a sibling there; input: one config with assignments, a user-added role and a removal marker · trigger: project it through both the `roles:get-all` path and the HTTP projection · observable: same effective schema and same assigned value per role, neither reporting a removed name (test-plan #F1)
- [x] 8.2 Author the payload-regression test in `packages/extension/src/__tests__/`, copying glue from the nearest existing role-manager test; input: configs with well-formed presets and no removal/assignment collision · trigger: run `roles:get-all` before and after the helper move · observable: payload identical, with the two declared corrections the only permitted diffs (test-plan #F2)

## 9. Tests — process smoke (L2)

- [x] 9.1 Author the session-less reachability smoke test in `qa/tests/`, copying endpoint-probing glue from `qa/tests/24-gateway-where.sh`; input: dashboard server running with zero pi sessions connected · trigger: GET /api/roles over HTTP · observable: 200 with a non-empty `data` array (test-plan #X8)

## 10. Verification and documentation

- [x] 10.1 Run the full suite per the repo procedure (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary) and verify zero failures
- [x] 10.2 Restart the dashboard via `curl -X POST http://localhost:8000/api/restart` and verify `GET /api/roles` returns the live role schema with unassigned roles present as `ref: null`
- [x] 10.3 Delegate to DocScribe a caveman-style update to `docs/architecture.md` recording the HTTP role read surface and the per-key ownership split of `providers.json`; verify the section exists and references no raw hex/px or prose filler
- [x] 10.4 Verify every new file has a row in its nearest directory `AGENTS.md` by running `kb dox lint` and confirming no `missing-row` findings for this change
- [x] 10.5 Manually verify the consuming frontend renders the role matrix correctly — unassigned roles read as empty slots rather than errors, and built-in versus custom is visually distinguishable (test-plan: manual-only)
