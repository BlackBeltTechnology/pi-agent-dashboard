## 1. Plugin scaffold

- [ ] 1.1 Create `packages/workflows-plugin` following the add-new-plugin-package checklist (manifest, workspace, contract tests, AGENTS.md)
- [ ] 1.2 Add `WorkflowActionDescriptor`, builtin-visibility and `workflow_invoke` types to `packages/shared`

## 2. Loader + validator

- [ ] 2.1 Write failing tests: discovery from the session checkout; invalid file isolated; unknown top-level key; `subject` other than `openspec-change`; undefined gate ref; gate cycle; `file` path escape; unknown `{var}`; `automation` + `attended: true`
- [ ] 2.2 Implement loader + validator with error paths (D8); per-checkout cache invalidated by file mtime

## 3. Facts, gates, stages

- [ ] 3.1 Write failing tests for each fact predicate and `all`/`any`/`not` composition, incl. same change in primary vs worktree session
- [ ] 3.2 Implement fact extraction from poller + git data, `file` stats only for attached changes (D3)
- [ ] 3.3 Write failing tests: bash gate not run when untrusted; timeout → false; TTL cache; concurrency cap; hostile `{change}` quoted
- [ ] 3.4 Implement bash gate runner (argv `bash -c`, quoted interpolation, timeout, cache)
- [ ] 3.5 Write failing tests: first-match stage resolution; no match → no actions
- [ ] 3.6 Measure poll-tick overhead with 20 attached changes; record before/after in the change folder

## 4. Trust

- [ ] 4.1 Write failing tests: untrusted → actions disabled with trust reason; grant session/project; edit invalidates; declarative gates evaluate without trust
- [ ] 4.2 Implement trust on the shared worktree-init trust store shape, `workflow-trust.json` namespace (D4)
- [ ] 4.3 Client trust dialog listing gates and steps

## 5. Actions + descriptors

- [ ] 5.1 Write failing tests: offering by stage, `requires` reason, working-session block, primary selection across files (file-name order), `builtins` keep/hide/hideWhen with `hide` winning, `detach` not hideable
- [ ] 5.2 Implement descriptor computation and broadcast with the change data (D2)
- [ ] 5.3 Extend `deriveOpenSpecActions` with optional workflow descriptors + builtin visibility; failing tests first (existing tests stay green)
- [ ] 5.4 Wire handlers in `SessionOpenSpecActions.tsx` and the composer strip; confirm dialog

## 6. Executors

- [ ] 6.1 Write failing tests: `prompt` in attached / spawned:<id> / new; chained prompt waits for turn end
- [ ] 6.2 Implement `prompt` + `spawn` (local, worktree via `add-plugin-spawn-worktree`, `attended:false` → excludeTools `ask_user`) (D6)
- [ ] 6.2a Failing tests: attended spawned sessions carry `extensionConfig: { "pi-dashboard": { askUserPromptTimeoutSeconds: "0" } }` (from `add-pending-question-stack`); workflow-spawned sessions are stamped with the invoking principal via the trusted owned-spawn road so their questions stay visible under an active ownership resolver
- [ ] 6.3 Automation plugin: provide `automation.runInline` with origin tag + completion callback; failing tests first; Automation view shows origin label
- [ ] 6.4 Goal plugin: provide `goal.create` with origin tag + terminal-status callback; failing tests first; Goals view shows origin label
- [ ] 6.5 Implement `automation`, `goal`, `flow` executors as consumers (D5); missing service → disabled descriptor
- [ ] 6.6 Failing step stops the action and surfaces the error on the change row

## 7. REST

- [ ] 7.1 Add the three routes to `route-tiers.ts` (`observe`, `observe`, `operate`)
- [ ] 7.2 Write failing tests: list with errors + trust; actions with reasons; invoke disabled/untrusted/unoffered → error, nothing runs
- [ ] 7.3 Implement routes; document in `api-reference.md`

## 8. Repo example + docs

- [ ] 8.1 Add `.pi/workflows/openspec.yaml` for this repo (design example)
- [ ] 8.2 DocScribe: `docs/project-workflows.md` (format reference, trust, executors); AGENTS.md rows for new files
- [ ] 8.3 Run `Audit` subagent on bash gates, interpolation, trust and the invoke route
- [ ] 8.4 Full test run + build; manual check: plan-proposal button on develop, Worktree + ship-it from develop, Apply hidden on develop
