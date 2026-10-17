# Test Plan — fix-home-folder-scope-double-arm

Stage: design   Generated: 2026-10-17

Hard gate passed with no clarifications: every Triple slot fills from the ADDED
requirement "The global home directory is never also a folder scope" and its six
scenarios.

Observables:
- the engine arm log `[engine] armed N automation(s) across M scope(s)` (emitted
  through `ctx.logger.info`, `index.ts:330`, from `engine.ts:1171`);
- the roles "used by" callback, which consumes `listScopes()` and labels entries
  `` `${scope}:${name}` `` (`role-usage.ts:22`);
- `ctx.spawnSession` call count;
- the `/list` JSON body.

Harnesses:
- **plugin harness:** `registerPlugin(ctx)` with a fake ctx, fake timers, and
  `process.env.HOME` pointed at a tmp dir (`os.homedir()` honours `$HOME` on
  POSIX). Exemplar: `packages/automation-plugin/src/server/__tests__/engine-init-after-listen.test.ts`.
- **route harness:** `mountAutomationRoutes(Fastify(), hooks)` + `app.inject`.
  Exemplar: `packages/automation-plugin/src/__tests__/routes-stop.test.ts`.

`H` = the tmp home dir, containing `H/.pi/automation/nightly/automation.yaml`
(`on.kind: schedule`, `cron: "* * * * *"`, `model: "@fast"`, valid).

**RED vs guard.** Rows marked **RED** fail on the pre-change code. Rows marked
**guard** pass before and after the fix; they pin behaviour the fix must not
break. A guard passing before the fix is expected and is NOT the
`systematic-debugging` trigger. A RED row passing before the fix IS that
trigger.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Session in the home directory does not double-arm (RED) | decision-table (global on × session cwd = H) | L1 | automated | plugin harness; `scanGlobalScope` on, `scanFolderScope` on; `sessionManager.listAll()` → `[{ cwd: H }]` | `registerPlugin`; advance past `ENGINE_INIT_DELAY_MS` | arm log reads `armed 1 automation(s) across 1 scope(s)`; roles usage returns exactly one entry, label `global:nightly` (today: 2 armed across 2 scopes, plus a `folder:nightly` entry) |
| E2 | Session in the home directory: one occurrence starts exactly one run (RED) | state-transition (armed → fired) | L1 | automated | as E1; `spawnSession` mocked to resolve | advance fake clock to the next minute boundary | `spawnSession` called exactly 1× for that occurrence (today: 2×) |
| E3 | Equivalent spelling of the home directory is recognized (RED) | EP (trailing-slash spelling) | L1 | automated | as E1 but session cwd = `H + "/"` | `registerPlugin`; advance past init delay | arm log reads `armed 1 automation(s) across 1 scope(s)`; no `folder:` roles-usage entry |
| E4 | A global run's own session does not create a folder scope (RED) | state-transition (no session → run session appears → rescan) | L1 | automated | plugin harness, global on, `listAll()` initially `[]`; after the first `spawnSession` call, `listAll()` also returns `{ cwd: H }` (the run's session) | advance to the first occurrence, then emit one `onEvent` activity event and advance past `RESCAN_DEBOUNCE_MS` | the arm log after the rescan still reads `armed 1 automation(s) across 1 scope(s)`; advancing to the next occurrence calls `spawnSession` 1× more (2× total, not 3×) |
| E5 | Home-directory session still arms when global scanning is off (guard) | decision-table (global off × session cwd = H) | L1 | automated | plugin harness; `scanGlobalScope: false`, `scanFolderScope` on; `listAll()` → `[{ cwd: H }]` | `registerPlugin`; advance past init delay | arm log reads `armed 1 automation(s) across 1 scope(s)`; roles usage has exactly one entry, label `folder:nightly` |
| E6 | Subdirectory of the home directory is unaffected (guard) | BVA (H vs. child of H) | L1 | automated | plugin harness, global on; `H/proj/.pi/automation/build/automation.yaml` (valid); `listAll()` → `[{ cwd: H + "/proj" }]` | `registerPlugin`; advance past init delay | arm log reads `armed 2 automation(s) across 2 scope(s)`; roles usage contains `global:nightly` and `folder:build` |
| E7 | Board list in the home directory shows each global automation once (RED) | decision-table (route × cwd = H × hook absent) | L1 | automated | route harness, `HOME=H`, no `scanGlobalScope` hook | `GET /api/plugins/automation/list?cwd=<H>` | `automations` has exactly one `nightly` entry, `scope: "global"`; no entry has `scope: "folder"` (today: two entries) |
| E8 | Board list keeps the armed copy when global scanning is off (guard) | decision-table (route × cwd = H × hook → false) | L1 | automated | route harness, `HOME=H`, hook `scanGlobalScope: () => false` | `GET /api/plugins/automation/list?cwd=<H>` | `automations` contains a `nightly` entry with `scope: "folder"` (the global entry also stays, as the documented pre-existing behaviour) |
| E9 | Board list in a non-home cwd is unaffected (guard) | EP (cwd ≠ H) | L1 | automated | route harness, `HOME=H`, repo `R` (tmp, outside H) with `R/.pi/automation/build/automation.yaml` | `GET /api/plugins/automation/list?cwd=<R>` | entries: `build` with `scope: "folder"` and `nightly` with `scope: "global"`, each exactly once |
| E10 | Contributed home base stays dropped with global scanning off (guard) | decision-table (contribution base = H × global off) | L1 | automated | `collectFolderScopeBases([{ key: "automation.folderscope.x", value: { base: H } }], { warn, homeDir: H })` (exemplar `packages/automation-plugin/src/__tests__/folder-scope-contributions.test.ts`) | call it | returns `[]` (unchanged, unconditional drop at `folder-scope-contributions.ts:76`) |

### Error-handling

None. The change adds no I/O, no new failure point, and no new input path:
`path.resolve` on a string cwd and a config boolean read. Existing fault
isolation (`listAll()` throwing, `index.ts:299-301`) is untouched.

---

## Coverage summary

- Requirements covered: 1/1 (all 6 ADDED scenarios, plus 4 guard rows: E5, E6
  and E9 for no regression, E10 for the restated contributed-base drop)
- Scenarios by class: edge 10 · perf 0 · frontend 0 · error 0
- RED rows: E1, E2, E3, E4, E7 · guard rows: E5, E6, E8, E9, E10
- Scenarios by level: L1 10 · L2 0 · L3 0
- Scenarios by disposition: automated 10 · manual-only 0

No performance scenario: no latency budget, no new I/O. No frontend scenario: the
client is unchanged; the board fix is server-side in `/list` and asserted at the
route (E7–E9).

## New infra needed

None. Every row extends an existing vitest harness:
- E1–E6: new spec file beside `engine-init-after-listen.test.ts`
  (`packages/automation-plugin/src/server/__tests__/`);
- E7–E9: new spec file beside `routes-stop.test.ts`
  (`packages/automation-plugin/src/__tests__/`);
- E10: `folder-scope-contributions.test.ts`.
