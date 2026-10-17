## 1. Generation and stamp

- [ ] 1.1 Write failing tests for `packages/server/src/openspec/workflow-schema.ts` `generateWorkflowSchema(root)` against a temp repo: calls `schema which` / `fork --force` / `validate` through the platform runner, applies patch v1 (design `Not needed:` line appended to the `design` instruction), writes the `x-pi-dashboard` stamp, keeps YAML comments; verify `npx vitest run packages/server/src/openspec/__tests__/workflow-schema.test.ts` is red
- [ ] 1.2 Implement generation with temp-dir + atomic swap; a failing `validate` leaves the previous directory byte-identical; verify 1.1 green
- [ ] 1.3 Write failing tests for `compareStamp(stamp, bundled)`: older → stale, equal → ok, newer → ok (never downgrade), missing stamp → user-owned; verify red, implement, verify green
- [ ] 1.4 Add OpenSpec CLI recipes (`OPENSPEC_SCHEMA_WHICH`, `OPENSPEC_SCHEMA_FORK`, `OPENSPEC_SCHEMA_VALIDATE`) in `packages/shared/src/platform/openspec.ts` with JSON parsing tests (experimental-notice preamble tolerated); verify green

## 2. Pin, enable, disable

- [ ] 2.1 Write failing tests for `pinUnpinnedChanges(root)`: writes `schema: spec-driven` only where missing, prepends to an existing file without `schema:`, never touches files that have it, skips `archive/`, atomic writes, idempotent second run writes nothing; verify red
- [ ] 2.2 Implement pinning; verify 2.1 green and a 100-change fixture completes in < 100 ms
- [ ] 2.3 Write failing tests for `enableWorkflowSchema(root)` ordering (generate → pin → validate → config switch), comment-preserving `config.yaml` edit, returned written-path list, no git commands invoked; and `disableWorkflowSchema(root)` keeping the schema dir while a change pins it; verify red
- [ ] 2.4 Implement enable/disable/update/remove; verify 2.3 green
- [ ] 2.5 Integration test with the real CLI in a temp copy of a fixture repo: after enable, `openspec status --all` reports every pre-existing change as `spec-driven`, `openspec new change x` pins `pi-spec-driven`; verify green (skip only when the CLI is absent)

## 3. REST endpoint and config

- [ ] 3.1 Add `openspec.workflowSchema.defaultForNewProjects` (default `false`) to `packages/shared/src/config.ts` with schema/validation tests; verify green
- [ ] 3.2 Write failing route tests for `POST /api/openspec/workflow-schema`: admission gates identical to `openspec_refresh` (untracked / opted-out / no `openspec/` → rejected with zero fs access), path containment to `<root>/openspec/`, worktree flag in the response, action validation; verify red
- [ ] 3.3 Implement the route in `packages/server/src/routes/openspec-routes.ts` with one structured log line per call (cwd, action, written paths, stamp before/after); verify 3.2 green
- [ ] 3.4 Run the enable flow after a successful dashboard-performed OpenSpec init when `defaultForNewProjects` is true; test both flag values; verify green

## 4. Readiness and evidence scoping

- [ ] 4.1 Write failing tests for `deriveOpenSpecReadiness` reasons `schema-missing`, `schema-stale`, `unpinned-changes` and the precedence `missing-skills` > `schema-missing` > `profile-stale` > `schema-stale` > `unpinned-changes`; newer stamp never stale; verify red
- [ ] 4.2 Implement the inputs (configured schema name, resolvability, stamp, unpinned count from the poll's tracked-path walk) and reasons in `packages/server/src/openspec/readiness.ts` + `packages/shared/src/types.ts`; verify 4.1 green
- [ ] 4.3 Write a failing test that design R1/R2/R3 promotion does not fire for `schemaName: "pi-spec-driven"` and still fires for `spec-driven`/absent; implement in `packages/shared/src/openspec-poller.ts`; verify green

## 5. Client and project-init

- [ ] 5.1 Settings → OpenSpec: global `defaultForNewProjects` switch + per-project enable/disable toggle that previews paths to be written and shows the worktree notice; component tests; verify green
- [ ] 5.2 Readiness actions: Update for `schema-missing`/`schema-stale`, Pin for `unpinned-changes`; component tests; verify green and `npm run build` succeeds
- [ ] 5.3 Update `packages/extension/.pi/skills/project-init/SKILL.md` with the post-init enable step (dashboard reachable + flag on; failure never fails init); verify the project-init skill tests pass

## 6. Docs and closeout

- [ ] 6.1 Delegate to DocScribe: `docs/architecture.md` section on the workflow schema (generation, stamp, enable order, multi-user rules) and a `docs/faq.md` entry "How do I enable the pi-spec-driven workflow schema?"; verify both via `grep -n "pi-spec-driven" docs/`
- [ ] 6.2 Update AGENTS.md rows for every touched/new file (`workflow-schema.ts`, `openspec-routes.ts`, `readiness.ts`, `config.ts`, `openspec-poller.ts`, settings components, project-init SKILL.md); verify `kb dox lint` clean for them
- [ ] 6.3 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and confirm no failures
