---
session: 019e9f24
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (8 user prompts); large facts sheet (~12630 tok)"
upgrade_status: pending
openspec_changes: [parallelize-test-suite]
proposal_excerpt: "The vitest suite runs effectively single-threaded. Every `packages/*/vitest.config.ts` pins `pool: \"forks\"` + `maxWorkers: 1`, so each project executes its test files one at a time. On a 16-logical-core box (8 physica…"
---

# How we did it: Parallelize the vitest suite — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: **`/skill:openspec-apply-change parallelize-test-suite`**.
The real objective, spelled out in the attached OpenSpec proposal, was concrete and
measurable: *the vitest suite runs effectively single-threaded because every
`packages/*/vitest.config.ts` pins `pool: "forks"` + `maxWorkers: 1`.* On a 16-logical-core
box that wastes ~15 cores. The task was to flip each project to `maxWorkers: "50%"`
**after** isolating the shared-state hazards (HOME, ports, localStorage) that only surface
under real parallelism — then prove it green with repeated runs, archive the change, ship a
PR, clear CodeRabbit, merge, and clean up the worktree. End result: **8m27s → ~1m31s
(≈5.6× faster)**, 3 consecutive clean runs, merged to `develop`.

## 2. TL;DR playbook

1. **Apply the plan through the skill:** `/skill:openspec-apply-change <change>` — let the
   phased tasks.md drive the work; do not free-solo the edits.
2. **Capture a baseline first.** `time npm test`, record wall time + which failures are
   *pre-existing and out of scope* (here: 16 `pi-image-fit` Jimp-dep failures) so you never
   chase a red that predates your change.
3. **Flip the safe projects first** (pure/plugin configs with no HOME/port/localStorage
   contention): `maxWorkers: 1 → "50%"`, run 3× for flake detection.
4. **Probe each hazard empirically before writing an isolation guard.** For localStorage,
   a throwaway probe test proved jsdom's store is per-fork in-memory → the planned 6-file
   guards were *unnecessary* and were skipped (simplicity-first).
5. **Isolate HOME per test file** with a `setupFiles` hook (`mkdtemp` HOME per file), wired
   via a **config-relative path** (worktree caveat, see §7). Apply it to every project that
   actually writes HOME state — audit, don't guess (shared, extension, subagents-plugin).
6. **Migrate real fixed-port binds to `port: 0`** + read the OS-assigned port back through
   getters. Skip files where the "port" is inert data (audit false-positives).
7. **Flip the contended projects, run the FULL suite 3×,** and fix every flake at its root
   (TOCTOU rebind race, shared providers.json) — not by retrying.
8. **Archive → commit (exclude local `.pi/settings.json`) → PR against `develop` → watch CI
   → process CodeRabbit at the root → squash-merge → remove worktree + branch.**

## 3. How the collaboration unfolded

**Phase 0 — Baseline & scope fencing.** The AI ran `time npm test`, logged **8m27s / 506s**,
and immediately triaged the 18 baseline failures: 16 `pi-image-fit` (`Jimp is not a
constructor`, a dependency issue) + a couple worktree artifacts. *Why it worked:* deciding
up front "these reds are pre-existing and out of scope" meant every later run was judged
against the right bar, and CI later confirmed image-fit passes where the deps exist.

**Phase 1 — Flip the safe projects.** 11 pure/plugin configs flipped `maxWorkers: 1 → "50%"`
via a mechanical `sed`, then ran 3× (2605 passed, no flakes). *Decision point:* start where
there is no shared state so you get an early confidence win.

**Phase 2 — Prove-don't-assume the localStorage hazard.** The plan wanted 6-file
`localStorage.clear()` guards. Instead the AI wrote a tiny probe test and *empirically*
showed `localStorage === window.localStorage`, `ctorName: "Storage"` (jsdom's), and that
writing it left Node's `--localstorage-file` untouched. Conclusion: jsdom localStorage is
per-fork in-memory → the guards were **skipped** as unneeded. *Why it worked:* an experiment
replaced a guess and removed code the plan would have added.

**Phase 3a — Per-file HOME hook.** New `packages/shared/src/test-support/setup-home-perfile.ts`
gives each test file a fresh `mkdtemp` HOME via `setupFiles`. First wiring crashed all 232
files — the worktree resolution caveat (§7). Fixed by pointing `setupFiles` at a
config-relative worktree path.

**Phase 3b — Port migration.** Migrated every file that *actually binds* a fixed port to
`port: 0` + `httpPort()`/`piPort()` getters. Crucially, the AI **read each suspect** and
rejected false-positives: `recovery-server` (port is data for a pure fn), `keeper-manager`
(dead-sidecar probes assert `alive:false` before TCP matters). A brace-aware guard test was
added to flag non-zero `port:` literals inside `createServer({...})`.

**Phase 3c + 6 — Flip contended projects, full-suite verification.** Server parallel: 159s →
~28s. Full suite: 8m27s → ~1m31s. But two flakes surfaced only under real parallelism —
`extension` role/model tests sharing `providers.json#roles`, and a `recovery-server`
probe-close-rebind **TOCTOU** race. Both fixed at the root (HOME hook applied to the 3
HOME-writing projects; `startRecoveryServer` changed to bind `port: 0` and return the bound
port). Then 3 consecutive clean full runs.

**Phase 7 — Archive → PR → CodeRabbit → merge → cleanup** (steering prompts 3–8). Archived
the change (new capability spec synced), committed 41 files *excluding* a machine-specific
`.pi/settings.json` diff, opened PR #87 against `develop`, watched CI green, processed 3
valid CodeRabbit threads at the root, hit + fixed a repo-lint `no-direct-platform-branch`
failure with a `// platform-branch-ok` marker, squash-merged, and removed the worktree +
branch.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change parallelize-test-suite`.** Effective because
  the heavy lifting (phasing, task ordering, acceptance criteria) already lived in the
  OpenSpec change; the slash command just handed the AI a plan to execute. *Lesson: front-load
  the thinking into the proposal, then let the apply-skill drive.*
- **`commit, push, create PR and monitor CI`** — one terse line that unlocked the entire ship
  sequence. High-leverage because the AI already knew the repo conventions (base branch
  `develop`, exclude local settings, squash-merge).
- **`Process coderabbit review issues` / `fix coderabbit issues`** — short, but they triggered
  a verify-each-thread-independently loop rather than blind acceptance.
- **`delete branch and worktree`** — trivial to say, but it exercised the worktree-cleanup
  path (operate from the main repo, `-D` because squash-merge hides merged-ness).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stall at the start ("openspec not initialized") | `meybe openspec not initialized` — nudged it to locate the change/skill | State the change is already scaffolded; point at `openspec/changes/<name>/` |
| Treat apply as the whole job | `/skill:openspec-archive-change`, then `commit, push, create PR and monitor CI` | Say up front: "apply → archive → PR → CI → CodeRabbit → merge → cleanup" is one flow |
| Wait for the next instruction between ship steps | Six one-line steering prompts (archive, PR, CodeRabbit ×2, merge, cleanup) | Give the full ship pipeline in one prompt so it runs end-to-end |

The corrections here were mostly *scope continuations* (each prompt extended the flow one
stage) rather than fixes — a sign the technical work itself was sound. The one real nudge was
the "openspec not initialized" hint that got it unstuck.

## 6. Skills, tools & memory created — and why they're effective

No skill was created, but **two project memories** were saved — both are the kind of
non-obvious trap that silently costs the next agent an hour:

- **Worktree package resolution (tool-quirk).** A `.worktrees/*` checkout has no own
  `node_modules/@blackbelt-technology`; package-name imports (`@blackbelt-technology/pi-dashboard-shared`)
  resolve to the **main repo's** `packages/shared`, *not* the worktree's. *Why effective:* it
  explains the "all 232 files crash on a file I just created" failure and prescribes the fix
  (config-relative `setupFiles` path, or `resolve.alias` to `../shared/src`).
- **No direct `process.platform` branches (convention).** The repo forbids
  `process.platform === "win32|linux|darwin"` outside `packages/*/src/platform/**` (enforced by
  `no-direct-platform-branch.test.ts`); use the `// platform-branch-ok:` marker with a
  justification for a localized opt-out. *Why effective:* this rule passes `tsc` but fails a
  repo-lint **vitest** test — so it only bites in CI, exactly the surprise this memory prevents.

**Skill worth creating:** a `parallelize-vitest-project` playbook (baseline → flip-safe →
probe-hazard → HOME/port isolation → full-suite-3× → root-fix flakes) — this session followed
that arc precisely and it will recur for any new package.

## 7. Pitfalls & dead ends

- **`setupFiles` crashed all 232 test files.** Cause: the new file was imported by package
  name, which resolved to the main repo (missing the file). *Fix:* wire `setupFiles` via a
  **config-relative worktree path**, not a package-name import.
- **Chasing pre-existing reds.** 16 `pi-image-fit` `Jimp is not a constructor` failures exist
  on baseline and in the local worktree (missing deps). *Fix:* fence them as out-of-scope;
  they pass in CI where `npm ci` installs the deps.
- **Audit false-positives on "fixed ports."** `recovery-server` (port is data for a pure fn)
  and `keeper-manager` (dead-sidecar probes) look like fixed binds but never really bind.
  *Fix:* read the file before migrating; don't blanket-`sed`.
- **Flakes only under real parallelism.** `providers.json#roles` contention (extension) and a
  probe-close-rebind **TOCTOU** (recovery-server) were invisible serially. *Fix:* run the FULL
  suite 3× and fix at the root (per-file HOME hook; bind `port: 0` and return the bound port).
- **`process.platform` fix passed tsc, failed CI.** The Windows HOME fix tripped
  `no-direct-platform-branch`. *Fix:* add `// platform-branch-ok:` with a reason.
- **Committing local settings.** `.pi/settings.json` had a machine-specific path diff. *Fix:*
  `git restore` it and exclude from the commit.
- **Shell pinned to a deleted worktree.** After `git worktree remove`, follow-up commands fail
  because the session cwd no longer exists. *Fix:* the deletions already succeeded; switch the
  terminal cwd back to the main repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change scaffolded at `openspec/changes/<name>/`; a
clean baseline (`git status` clean); knowledge of which baseline failures are out-of-scope.

- [ ] `time npm test` → record wall time + fence pre-existing failures.
- [ ] Flip pure/plugin configs `maxWorkers: 1 → "50%"`; run 3×.
- [ ] Probe each shared-state hazard (localStorage/HOME/ports) **before** writing a guard.
- [ ] Add per-file HOME `setupFiles` hook via a **config-relative** path; apply to every
      HOME-writing project (audit, don't guess).
- [ ] Migrate real fixed-port binds to `port: 0` + getters; skip inert-data false-positives;
      add a brace-aware guard test.
- [ ] Flip contended projects; run the **full** suite 3×; root-fix every flake.
- [ ] Archive change → commit (exclude local `.pi/settings.json`) → PR vs `develop` → CI →
      CodeRabbit at root → squash-merge → remove worktree + branch (`-D`, from main repo).

**Artifacts produced:** `packages/shared/src/test-support/setup-home-perfile.ts` (per-file
HOME hook); `maxWorkers: "50%"` across all `packages/*/vitest.config.ts`; migrated fixed-port
tests + a `createServer` port-guard canary; PR #87 merged to `develop` (≈5.6× faster suite).

---

_Generated from session `019e9f24` · `pi-agent-dashboard` · 2026-06-07. Source extract: facts sheet (mktemp)._
