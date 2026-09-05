## Context

`npm test` is green on CI and red on developer machines, with a **rotating** failing set. Reproduced on clean `develop` @ `3053db19`:

- CI (`ubuntu-latest`, `pnpm install --frozen-lockfile`, `pnpm test`): 1201 files passed, 0 failed.
- Local `npm test`: 3 failed — `scripts/skill-frontmatter.test.mjs` plus 2 in `useImagePaste.test.ts`.
- Local `npm test --maxWorkers=2`: 1 failed — only the frontmatter guard.
- `useImagePaste.test.ts` alone: 10/10. All 39 `client/src/hooks` files: 252/252.

Two independent causes, both regressions against shipped requirements:

**A. `skill-frontmatter-validity`.** The spec excludes "`node_modules`, build output, and worktree checkouts". The implementation encodes that as a basename set: `{node_modules, .git, dist, build, coverage, .next, out, worktrees, .worktrees}`. `packages/electron/resources/bundled-extensions/` matches none of them, so the walk descends into it and picks up the 13 `SKILL.md` files it holds — the repo-wide walk collects 80. Two of the 13 (`release-cut` at 411 chars, `release-revoke` at 431) exceed the 400-char budget and fail `has no budget warning outside the exempt skills`.

The directory is **not** produced by a current build step. `packages/electron/forge.config.ts:109` records that bundled-extensions resources were removed under `eliminate-electron-runtime-install`; nothing writes there now. Because it is gitignored (`.gitignore:26`), the stale copy was never cleaned and persists on any machine that ran the old build. CI's fresh checkout never has it. The two offending files are vendored copies from the third-party `pi-anthropic-messages` package — their wording differs from the repo's own `release-cut` (384) / `release-revoke` (340), which are under budget. Deterministic; not a flake.

**B. `parallel-test-execution`.** The spec states tests "SHALL assert on polled DOM/mock state (`waitFor`) rather than a fixed number of macrotask ticks". Nothing enforced it. 11 client test files await a bare `setTimeout`; **10 use it as a barrier** before a one-shot assertion, which is the banned pattern. `useImagePaste.test.ts` is simply the one that lost the scheduling lottery this week: `expected [] to have a length of 2 but got +0`. The other 9 are latent instances of the identical race. The 11th, `PairLanding.test.tsx:54`, yields inside a `postJson` mock so React can commit a render — it gates no assertion and is not an instance of the defect.

**Why the failing set rotates.** This repo's normal working state is a dashboard server, live pi sessions and multiple worktrees running concurrently. Whichever timing-fragile test loses the lottery on a given run goes red, so the set changes between runs and between machines — which is what makes it read as "pre-existing noise".

**Falsified hypotheses**, recorded so they are not re-derived:
- *pi version skew.* `packages/server` declares `^0.83.0` and the lockfile's `packages/server` importer resolves **0.83.0**, so that declaration is satisfied. (The lockfile also carries `0.80.10` for other importers pinned to `*` — multiple versions coexisting is expected, not skew.) A local `packages/server/node_modules/` holding 0.81.1 is a stale install that `pnpm install` fixes. CI installs the same lockfile and passes.
- *macOS `/var` → `/private/var` realpath divergence.* Forcing a realpath'd `HOME` changed nothing.
- *Worker-count throttling.* See D3.

## Goals / Non-Goals

**Goals:**
- `npm test` exits 0 on a developer machine, repeatably, without hand-tuned flags.
- A failure is trustworthy: red means "you broke something", not "the box was busy".
- The client suite genuinely complies with the shipped no-fixed-tick requirement, and a guard keeps it that way.

**Non-Goals:**
- Throttling worker count (cut — see D3).
- Pinning or bumping `@earendil-works/pi-coding-agent`; the lockfile is already correct.
- Auditing `packages/server` and plugin tests for fixed-tick waits. The guard ships client-scoped; widening is follow-up.
- Changing CI parallelism or any test's assertions/coverage. Conversions are behaviour-preserving.

## Decisions

### D1 — Exclude generated trees by git-ignore status, layered over the basename prune

> **DROPPED by scope amendment (2026-08-01).** The defect D1 addressed was already
> fixed on `develop` by `71ea6e593` (tracked-file filter in `analyzeRepository`),
> landed while this change sat in planning. Residual hardening idea (the landed
> fix's no-git degraded mode judges all files, unlike D1's prune-only fallback)
> is a follow-up, not a defect. Full evidence: `SHIP_IT_BLOCKED.md`.

`collectSkillManifests()` keeps its existing `SKIP_DIRS` prune during the walk, then filters the collected candidate list through a single batched `git check-ignore --stdin` call. Git-ignore is an **additional** exclusion layer, not a replacement.

*Why layered, not replacing:* the spec's intent is "don't scan things that aren't source", and git already owns that answer. But making git the *only* layer has two failure modes the first draft of this design missed:
1. Pruning during the walk is what keeps it cheap. You cannot decide whether to descend from a batched call that needs the candidate list to exist first — the two are mutually exclusive. Keeping `SKIP_DIRS` as the descent prune resolves the contradiction: walk prunes by name, then git filters what survives.
2. If `SKIP_DIRS` shrank to `{node_modules, .git}`, the degraded (no-git) path would silently stop excluding `dist`/`build`/`.worktrees` — a regression against the shipped "excluding build output" requirement, and on this machine it would descend into 4 worktree checkouts.

*Alternative rejected:* adding `"bundled-extensions"` to `SKIP_DIRS`. One line, fixes today, guarantees the same bug the next time something writes SKILL.md into an unlisted directory — this bug *is* that drift. It also over-matches any legitimately tracked directory of that name.

*Alternative rejected:* driving the walk from `git ls-files`. Cleaner, but excludes intentionally untracked local skills, which is a real workflow here.

*Path normalization:* candidate paths are built with `path.join`, so on Windows they carry backslashes while `.gitignore` patterns use forward slashes. Paths are converted to posix separators before being fed to `git check-ignore`, otherwise the guard would silently treat gitignored trees as not-ignored on Windows — reintroducing the exact bug.

*Degraded mode:* a missing or failing `git` is caught; every candidate is treated as not-ignored and the basename prune stands alone. This is strictly today's behaviour, so the shipped exclusion guarantee survives.

*Cost:* one subprocess for the whole walk. The guard runs in ~650ms; a single batched git call is noise against that.

### D2 — Convert all 10 fixed-tick barriers to `waitFor`, then guard the pattern

Every client test that awaits a bare `setTimeout` **as a barrier** is converted to poll via Testing Library's `waitFor`, inside the already-configured 5s `asyncUtilTimeout`. Then a guard test hard-fails on the pattern.

*Barrier vs yield — the distinction the guard must respect.* A **barrier** awaits a timer in test body scope and then asserts one-shot; that is the race. A **yield** awaits a timer inside a mock implementation to let React commit, and gates nothing. `PairLanding.test.tsx:54` is the latter and is deliberately not converted — converting it would alter the poll-mock timing the test exists to cover, violating behaviour-preservation. It carries an opt-out comment instead and serves as the guard's day-one false-positive exemplar.

*Why all 10 rather than the one that flaked:* they are the same defect, and the guard cannot hard-fail while 9 violations remain. The alternatives were worse — shipping the guard warning-only defers the enforcement that is the whole point, and exempting 9 files bakes a permanent allowlist into a rule that has already been ignored once. Fixing them is mechanical and behaviour-preserving.

*Why not raise the tick count:* the failure mode is unbounded scheduling delay, not a known number of ticks. More ticks buys margin and fixes nothing.

*Why not mock `FileReader` synchronously:* removes the flake and the async behaviour the test exists to cover.

*Guard scope:* the pattern is a `setTimeout` whose callback is a bare resolve, awaited as a barrier. It is client-scoped for now. The opt-out is **per occurrence, not per file** — an inline comment on the line immediately above the awaited timer, naming the reason. A per-file waiver would silently excuse any real barrier added to that file later, which would hollow out the "client suite contains no violations" guarantee. False positives are the known cost of a textual guard; a line-scoped opt-out is the release valve without the blast radius.

### D3 — Do NOT throttle worker count; give `maxWorkers` one home instead

The worker *value* is unchanged. It moves behind a single shared helper so 26 configs stop each declaring their own.

*Why the throttle was cut:* an earlier draft reduced `maxWorkers` when `os.loadavg()[0]` exceeded core count. Two reviewers independently found it incapable, and the measurement confirms it. `vitest.config.ts` is evaluated **before** vitest forks its workers, so the load average it can observe is ambient load — not the contention the run is about to create. Sampled on the affected machine at rest: `9.93` against 16 cores, which selects `"50%"` = 8 workers, precisely the configuration that fails. The `24.65` figure that motivated the idea was measured *during* a run and was therefore largely self-inflicted. A mechanism that can only see the wrong quantity at the wrong time is not a fix.

It was also aimed at the symptom. Once the 11 tests poll instead of guessing ticks, they tolerate contention by construction and the worker count stops being load-bearing.

*Why consolidate anyway:* 28 independent copies of a concurrency setting is a standing hazard — the next person tuning it will find and change one. One module makes the suite's concurrency policy greppable and gives any future change a single edit point.

*Where it lives, and why not `packages/shared`:* the module sits at the **repo root** (`vitest.workers.ts`) and is imported by relative path. Only 15 of the 28 vitest configs currently reference `@blackbelt-technology/pi-dashboard-shared`; hosting the helper there would force a new workspace dependency onto 13 packages — including leaf publishable ones — purely to read a number. A root-level module that vitest configs import by path adds no `package.json` edge anywhere and cannot create a cycle.

*Serial projects are exempt, not migrated:* **7** projects run at `maxWorkers: 1` by design — `electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`. Each keeps its explicit literal and does **not** import the module. The module carries the parallel default only; it is not a mandate that every config must import.

*Alternative rejected:* sampling load mid-run via a reporter hook. Technically able to see the right quantity, but vitest cannot resize a running pool, so it could only warn — and a warning is not worth a custom reporter.

### D4 — Verify by repetition where the spec demands it

The `parallel-test-execution` delta inherits the shipped **3 consecutive green runs** gate; a single pass proves nothing about a rotating failure. Defect A is deterministic and needs only a single verification, which the frontmatter delta reflects — it carries no repetition gate.

## Implementation-phase findings (2026-09-01)

- **P2 (3-consecutive-run gate) — environment-limited, 2026-09-01.** Eight full
  runs on the loaded dev box produced a DIFFERENT single rotating casualty per
  run: `auth-redirect-base` P1 (100ms wall-clock perf budget), `keeper` E5
  (one-shot post-rotation read — baseline casualty, fixed by this change
  mid-verification, green in every run since), `cli-signal-forwarding`
  (SIGTERM real-process timing), `FileLink.split` (waitFor 5s budget starved
  at extreme load). Zero
  failures ever in this change's own scope. The class — real-process,
  wall-clock-budgeted server tests + extreme-load starvation — is pre-existing
  and owned by the follow-up change `contention-harden-real-process-tests`.
  CI (controlled load) is the authoritative gate per the proposal's baseline.
- **Follow-up noted (review, non-blocking):** the 8 stable-negative conversions
  use `await act(async () => {})` (microtask flush) where the old code waited a
  real timer. For "never called / never rendered" assertions a regression that
  defers the forbidden action to a macrotask would evade the flush window;
  `vi.useFakeTimers()` + `advanceTimersByTime` is the stronger form. The tested
  decisions are synchronous (verified per site), ids are census-pinned, and the
  reviewer classified this non-blocking — deferred as a follow-up, not shipped
  as a weakening.
- **Worktree-without-install mimics the defect.** A `.worktrees/` checkout with no
  root `node_modules` resolves `vitest` and every dep from the PARENT checkout —
  failures appear (pi-version-skew X13, verify-published-imports X3, kb eval-guard,
  browse-endpoint) that are install artifacts, not suite defects. Run `pnpm install`
  in the worktree before drawing conclusions. Recorded in docs/faq.md.
- **Baseline on the installed tree:** run 1 failed `auth-redirect-base` P1 (100ms
  wall-clock perf budget under 8 forks); run 2 failed `keeper` E5 (interval-timer
  rotation) — the failing set still rotates, and both are timing-sensitive tests
  outside this change's fixed-tick scope.
- Defect A's upstream fix (`71ea6e593`) also covers proposal-era falsified
  hypotheses: pi lockfile skew and macOS realpath divergence were ruled out during
  planning; see proposal.md.

## Risks / Trade-offs

- **10 test files touched at once** → every conversion is mechanical (barrier → `waitFor`) with no change to assertions or coverage. Reviewable as one pattern repeated 10 times, and the suite itself is the check.
- **Textual guard produces false positives** → line-scoped inline opt-out with a stated reason; a known legitimate instance (`PairLanding.test.tsx`'s `postJson` mock yield) exercises that path on day one.
- **Barrier-vs-yield is a judgement call the guard cannot make** → the guard flags both; a human classifies once and annotates. Misclassifying a barrier as a yield is the residual risk, bounded by the opt-out requiring a written reason.
- **Guard is client-scoped, so server/plugin tests can still regress** → stated as a Non-Goal; widening is cheap once the client is clean.
- **`git check-ignore` adds a subprocess** → one batched call per run, against a ~650ms baseline.
- **Degraded mode is weaker than git-present mode** → it is exactly today's behaviour, so nothing regresses; git is present in every context that runs this guard.
- **Consolidating 21 configs is a wide, low-value diff** → mitigated by changing no values; a behaviour-preserving move that CI verifies by staying green. Worker counts are compared project-by-project before and after.
- **The user-reported jimp/bus-client failures are explained, not directly reproduced** → both pass 137/137 in isolation in the main checkout and in a worktree, and the contention model accounts for the rotation. If they resurface, the guard output and worker count are in the run log.

## Migration Plan

No production code, no data, no API surface. Landing is a normal merge; rollback is a revert.

Defect A is verified directly against the stale directory already present on the affected machine (`node scripts/check-skill-frontmatter.mjs` reports zero over-budget findings while `packages/electron/resources/bundled-extensions/` still exists on disk). It cannot be verified by "running the electron bundle step" — that step no longer produces the directory. Defect B is verified by the 3-run gate.

## Open Questions

- Should the fixed-tick guard widen to `packages/server` and the plugin projects in a follow-up, or stay client-scoped indefinitely?
- Is the stale `packages/electron/resources/bundled-extensions/` worth a cleanup note in the FAQ (it will linger on every machine that ran the pre-`eliminate-electron-runtime-install` build), or does the guard fix make it harmless enough to ignore?
