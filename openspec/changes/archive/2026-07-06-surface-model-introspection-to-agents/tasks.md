# Tasks — surface-model-introspection-to-agents

## 1. Server: ungated `GET /api/models`

- [x] 1.1 Add `registerModelsIntrospectionRoute` (or extend an existing session/provider route module) wiring `GET /api/models` to the shared `getRegistry()` dependency → verify: route returns `200` with a non-empty `data`/rows array against the running dashboard.
- [x] 1.2 Default response = reachability-filtered (`getAvailable()`); `?annotated=1` = `getAllAnnotated()` including `excludedReason` → verify: annotated response contains at least one row with `excludedReason` in {`no-credential`,`oauth-incompatible`} when an unauthed provider exists.
- [x] 1.3 Confirm no credential material in the payload (only id/provider/capability/cost) → verify: response body grepped for key/token/secret fields is empty. (`security-hardening` checkpoint.)
- [x] 1.4 Auth-gate posture matches decision in design.md Q1 → verify: behavior identical to `GET /api/provider-auth/status` for the gated/ungated case.

## 2. Skill: `dashboard-list-models` command

- [x] 2.1 Add `packages/extension/.pi/skills/pi-dashboard/commands/dashboard-list-models.md` (LIST counterpart to `dashboard-session-model`): resolve base URL/port the same way, call `GET /api/models[?annotated=1]`, report rows → verify: `/dashboard:list-models` returns the catalogue.
- [x] 2.2 Command text explicitly instructs: never parse `providers.json`/`models.json`; use this endpoint → verify: rule present in the command markdown.

## 3. Docs pointer

- [x] 3.1 Add a one-line entry to `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md` documenting `GET /api/models` (+ `annotated`) as the model-introspection surface → verify: entry present and matches route shape.
- [x] 3.2 Add the new command + reference rows to the nearest directory `AGENTS.md` per the Documentation Update Protocol → verify: rows present, path-alphabetical.

## 4. Tests

- [x] 4.1 Unit test for `GET /api/models`: default filtered vs `?annotated=1` shapes, and no-secret invariant → verify: `npm test` green for the new spec.
- [x] 4.2 `openspec validate surface-model-introspection-to-agents --strict` passes → verify: exit 0.

## 5. Gates (at completion, before commit)

- [x] 5.1 `npm run quality:changed` green. New route/test/server-edit are biome-clean under `--error-on-warnings` + tsc-clean; new server test 4/4 pass. (Pre-existing unrelated failures in `pi-image-fit-extension` + `pi-dashboard-web` reproduce with change stashed — not this change's; server.ts's Tier B/C `any` warnings pre-exist and are advisory.)
- [x] 5.2 CodeRabbit advisory review on the diff; 1 finding, 0 Critical/Warning (exit 0).
