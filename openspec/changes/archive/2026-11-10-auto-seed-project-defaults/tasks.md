# Tasks — auto-seed-project-defaults

## 1. Scaffold gap-fill mode

- [x] 1.1 `packages/extension/src/project-init/scaffold.ts`: add
  `ScaffoldOptions.skipExisting` + `ScaffoldResult.skipped`; one
  `shouldWrite(target)` guard gating `AGENTS.md`, `.pi/settings.json` and each
  prompt file; suppress the conflict throw in that mode.
- [x] 1.2 Same file: append the DOX doctrine only when the call created
  `AGENTS.md` (`!skipExisting || wroteAgentsMd`); record an untouched
  `knowledge_base.json` in `skipped` via `kbConfigPath`.
- [x] 1.3 `packages/extension/src/__tests__/project-init-scaffold.test.ts`: two
  cases — gap-fill leaves a pre-existing `AGENTS.md` byte-identical with
  `doctrineSeeded: false`; a created `AGENTS.md` still gets the doctrine.

## 2. Cross-package import surface

- [x] 2.1 `packages/extension/package.json`: add an `exports` map mirroring
  `pi-dashboard-shared` (`./*.js` → `./src/*.ts`), with `./package.json`
  listed explicitly so `findBundledExtension`'s manifest resolve keeps working.

## 3. Seeding module

- [x] 3.1 New `packages/server/src/project-seed.ts`: `seedProjectDefaults`
  (config-root resolution, `$HOME` / filesystem-root / non-directory refusals,
  `isFullySeeded` short-circuit, per-root memo, stack detection, gap-fill
  scaffold, never throws).
- [x] 3.2 Same file: `scheduleProjectSeed` (`setImmediate` + log on write),
  `sweepKnownProjects`, `configureProjectSeed`, `resetSeededRoots`.
- [x] 3.3 `NO_STACK_SUBSTITUTIONS` rendering an inert `gate: "false"` /
  `command: "true"` hook plus `# TODO:` command comments.

## 4. Configuration

- [x] 4.1 `packages/shared/src/config.ts`: `DashboardConfig.autoSeedProjects`
  (documented), `DEFAULTS` entry `true`, and a boolean-guarded parse falling
  back to the default.

## 5. Wiring

- [x] 5.1 `packages/server/src/browser-handlers/directory-handler.ts`:
  `scheduleProjectSeed(resolved)` in `pinDirectorySideEffects` (covers the pin
  and workspace-eject paths).
- [x] 5.2 `packages/server/src/event-wiring.ts`: `scheduleProjectSeed(cwd)` in
  `piGateway.onSessionRegistered`.
- [x] 5.3 `packages/server/src/server.ts`: `configureProjectSeed(loadConfig().autoSeedProjects ?? true)`
  then `sweepKnownProjects(pinned ∪ workspace folders)` after
  `setCwdPolicyRegistry`.

## 6. Tests

- [x] 6.1 `packages/server/src/__tests__/project-seed.test.ts` — 11 cases: bare
  seed, stack-filled hook, inert hook, kb config shape, gap-fill
  non-destructiveness, memo idempotency, `force` re-run on a complete project,
  `$HOME` refusal, filesystem-root refusal, missing-path / file refusals,
  `autoSeedProjects: false`.
- [x] 6.2 Regression run: `project-seed` (11) + `project-init-scaffold` (12) +
  `project-init-dox-kb-config` (4) + `directory-handler` + remaining
  `project-init-*` suites → 52 passed across 7 files.
- [x] 6.3 `packages/shared` config suites → 196 passed across 6 files.

## 7. Docs

- [x] 7.1 Directory `AGENTS.md` rows: `packages/server/src/AGENTS.md`
  (`project-seed.ts`), `packages/extension/src/project-init/AGENTS.md`
  (`scaffold.ts` gap-fill).

## Notes

- Full-suite `npm test` shows 67 pre-existing failing files caused by
  `@fastify/rate-limit` missing from `node_modules` — unrelated to this change
  (`pnpm install` fixes it). No failure references any file touched here.
- The fifth checklist artifact, `openspec/`, is deliberately NOT seeded; it
  needs `openspec init` and keeps its own affordance.
