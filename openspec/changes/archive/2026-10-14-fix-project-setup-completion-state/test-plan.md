# Test Plan — fix-project-setup-completion-state

Stage: design   Generated: 2026-10-14

No clarifications outstanding (hard gate passed: every Triple filled from the delta specs + design D1–D4).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | banner: gate — configured row | decision-table | L1 | automated | `useInitStatus` mounted, probe → checklist `settings.present: true`, `isProjectRoot: true`, one session `streaming` | session status → `idle` | `fetchWorktreeInitStatus` call count stays 1 (mount only) |
| E2 | banner: gate — non-project-root | decision-table | L1 | automated | probe → `settings.present: false`, `isProjectRoot: false`, session `streaming` | status → `idle`; then `visibilitychange` → `visible` after fake-clock +31 s | call count stays 1 |
| E3 | banner: gate — uninterpretable only | decision-table | L1 | automated | first and only probe returns `{ hasHook: false }` (no checklist), `isProjectRoot: true` | session `streaming → idle` | call count stays 1 (no interpretable probe yet → gate closed) |
| E4 | banner: visibility throttle boundary | BVA | L1 | automated | not-a-project row, `isProjectRoot: true`, last probe issued at t0 (fake timers) | `visibilitychange` → `visible` at t0+29 999 ms, then at t0+30 000 ms | 0 extra calls at 29 999 ms; exactly 1 extra call at 30 000 ms |
| E5 | banner: throttle stamped at issue | BVA | L1 | automated | not-a-project row; a refetch issued at t0 whose promise never resolves | `visible` at t0+10 s | no extra call (throttle measured from issue, not response) |
| E6 | banner: entering streaming never fires | state-transition (illegal edge) | L1 | automated | not-a-project root row, session `idle` (seeded) | status → `streaming`, then → `active` | call count stays 1 |
| E7 | banner: coalesced triggers | EP | L1 | automated | not-a-project root row, sessions A,B `streaming` | single `sessions` update: A → `idle`, B → `ended` | exactly 1 extra call |
| E8 | banner: unrelated re-render | EP | L1 | automated | not-a-project root row, sessions `[A: idle]` | re-render with a new array instance carrying identical `id:status` | call count unchanged |
| E9 | skill: config fail-closed | decision-table | L1 | automated | `packages/extension/.pi/skills/project-init/SKILL.md` text | text-guard read | Step 3b names the unreadable/wrong-typed `~/.pi/dashboard/config.json` → skip + warn rule, and absent key → defaults (`enabled`, `offerInitialization`, `optOutDirectories`) |
| E10 | skill: opt-out pathKey one-liner | EP | L1 | automated | SKILL.md text; extract the embedded `node -e` opt-out comparison | run it with target `/Users/x/Proj` vs entries `/users/x/proj/` (darwin), `/Users/x/Proj` (linux), `/Users/x/Other` | exit/print = match, match, no-match respectively (lowercase unless linux; trailing separator stripped) |
| E11 | skill: git-placement + offer switch rows | decision-table | L1 | automated | SKILL.md text | text-guard read | Step 3b contains `--path-format=absolute`, `--is-inside-work-tree`, `--show-toplevel`, the `offerInitialization === false` → skip-offer rule, and the repair row keyed on `.pi/skills/openspec-explore` |
| E12 | skill: command + legacy disclosure | EP | L1 | automated | SKILL.md text | text-guard read | Steps 3b/3c/6 use `openspec init --tools pi --force`; list every entry of `LEGACY_CONFIG_FILES`, `LEGACY_COMMAND_DIRS`, `LEGACY_COMMAND_FILE_DIRS` parsed from `packages/server/src/routes/openspec-routes.ts`; mention both `OPENSPEC:START` and `OPENSPEC:END`, the generic "other legacy OpenSpec files" line, and global-config migration |
| E13 | skill: Step 6 gate + verify | state-transition | L1 | automated | SKILL.md text | text-guard read | Step 6 runs on `repair` or confirmed `offer`, verifies `.pi/skills/openspec-explore`, warns with an `ls .pi/skills` listing; the "Idempotent re-run" paragraph no longer claims Step 6 is skipped whenever `./openspec/` existed |

### Performance

_none — no latency/throughput threshold in the specs; request-volume bounds are covered as call-count invariants (E1–E8)._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | banner: setup turn finishes, session stays open | state-transition | L1 | automated | not-a-project root row; session A seeded `streaming`; mock next probe → `settings.present: true` | A → `idle` | exactly 1 extra call; hook `status` converges to the `present: true` payload |
| F2 | banner: session ends | state-transition | L1 | automated | not-a-project root row; A seeded `active` | A → `ended` | exactly 1 extra call |
| F3 | banner: turn completed while unobserved | state-transition | L1 | automated | not-a-project root row; seeded with `[A: streaming]` | update to `[A: streaming, B: idle]` (B never seen) | exactly 1 extra call |
| F4 | banner: session vanishes before `ended` seen | state-transition | L1 | automated | not-a-project root row; seeded `[A: streaming]` | update to `[]` | exactly 1 extra call |
| F5 | banner: first snapshot only seeds | state-transition | L1 | automated | not-a-project root row | mount with `[A: idle, B: ended]` | call count = 1 (mount fetch only) |
| F6 | banner: latest-wins | async convergence | L1 | automated | not-a-project root row; refetch #1 deferred (→ absent), refetch #2 deferred (→ present) | resolve #2, then #1 | final `status` = #2 payload (`present: true`) |
| F7 | banner: no set-after-unmount | async convergence | L1 | automated | refetch deferred | unmount, then resolve | no React state-update warning; no throw |
| F8 | banner: setup action spawns directly | EP | L1 | automated | `FolderActionBanner` rung `setup`, `onInitializeProject` spy | click `folder-banner-setup-action-<cwd>` | spy called once with `cwd`; component accepts no `sessions` prop (type-level) |
| F9 | banner: trigger survives banner remount | state-transition | L1 | automated | `FolderInitScope`-equivalent harness: hook owner stays mounted while the banner child is unmounted/remounted; not-a-project root | banner remount, then session `streaming → idle` with next probe → present | exactly 1 extra call and `folder-banner-setup-<cwd>` absent after re-render |
| F10 | banner: next rung after scaffold | state-transition | L1 | automated | `computeBannerRung(status, undefined, true)` with status `{ hasHook: true, trusted: false, checklist: [settings present] }` | evaluate | returns `"retrust"` (setup rung gone, re-trust in its place) |
| F11 | banner: tab return clears the banner end-to-end | state-convergence | L3 | automated | pinned session-less fixture without `.pi/settings.json` showing `folder-banner-setup-<cwd>` | write `<cwd>/.pi/settings.json` (`{}`) inside the container; wait > 30 s since load (or reload then advance); dispatch `visibilitychange` with `visibilityState` `hidden` → `visible` | `folder-banner-setup-<cwd>` detaches without page reload |
| F12 | banner: live turn-end clears banner with real session | state-convergence | — | manual-only | real dashboard, unconfigured git repo, click `Set up →`, complete project-init, leave session open | turn ends | banner leaves the setup rung (re-trust may appear) without ending the session or reloading [judgment: needs a real model turn; not reproducible in the docker harness without a live provider] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | banner: failed probe keeps gate open | fault-injection (abort) | L1 | automated | probe 1 → `present: false`; probe 2 rejects/fail-open `{ hasHook: false }` | session `streaming → idle` (fires probe 2), then another session `streaming → idle` | probe 3 is issued (gate uses last interpretable = not-a-project); `setupState` of displayed status after probe 2 = `unknown` |
| X2 | banner: abandoned setup | fault-injection (no-op remedy) | L1 | automated | not-a-project root; next probe still `present: false` | session → `ended` | 1 extra call; displayed status still not-a-project (banner would remain) |
| X3 | skill: OpenSpec repair on a pre-existing non-pi OpenSpec dir | fault-injection (partial state) | — | manual-only | scratch git repo with `openspec/changes/` but no `.pi/`, dashboard running | run project-init (coding profile) and confirm preview | no OpenSpec question asked; preview lists repair + side effects; afterwards `.pi/skills/openspec-explore/` exists and the folder OpenSpec pill is not "skills missing" [judgment: agent-driven skill execution with a live model] |
| X4 | skill: opted-out dir never repaired | fault-injection (policy) | — | manual-only | same scratch repo listed in `openspec.optOutDirectories` | run project-init (coding profile) | no OpenSpec command run; note says opted out [judgment: agent-driven skill execution with a live model] |

---

## Coverage summary

- Requirements covered: 2/2 (folder-action-banner "Banner reflects the per-artifact setup state"; project-init-skill "Project-init MAY initialize OpenSpec for coding profiles") — every delta scenario maps to ≥1 row.
- Scenarios by class: edge 13 · perf 0 · frontend 12 · error 4
- Scenarios by level: L1 25 · L2 0 · L3 1
- Scenarios by disposition: automated 26 · manual-only 3

## New infra needed

- none — L1 uses vitest + `@testing-library/react` `renderHook` with fake timers (existing in `packages/client`); L3 extends `tests/e2e/folder-action-banner.spec.ts` (session-less pinned `kb-sample` fixture) with container file write + the `visibilityState` override pattern from `tests/e2e/openspec-board-drop.spec.ts:367`.
