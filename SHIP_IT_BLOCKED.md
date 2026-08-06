# SHIP-IT HELD — fit-attachments-for-display (PR #419)

Still not merged. Work is done; the gate is waiting on a review that
CANNOT currently run.

## Round-3 MAJORs — status

| # | Finding | Status |
|---|---|---|
| GIF byte-scan false positive | `display-fit.ts` | FIXED `70d8ff336` — real block-stream walk; auto-resolved by the bot |
| pixel limit after GIF exemption | `display-fit.ts` | FIXED `70d8ff336` — guard now precedes the exemption; auto-resolved |
| settle fit jobs on shutdown | `fit-worker-pool.ts` | FIXED `70d8ff336` — root cause was worse than reported (see below); replied, awaiting re-eval |
| artifact under `archive/` | `design.md` | DISPUTED — replied with evidence, NOT actioned. See below. |

The shutdown fix: `fallbackSettle` deregistered a job BEFORE awaiting its
fallback slot, so a parked job was invisible to `dispose()` and its caller's
promise hung forever — not just a lingering timer. Reproduced as a 30 s test
timeout against the old code.

The disputed one: `AGENTS.md` forbids AUTHORING change artifacts under
`archive/`; it does not forbid the archive itself, which is where
`ship-change` moves a shipped change (`archive/YYYY-MM-DD-<change>/`) and
where 755 previous changes live. Moving it would un-archive a completed
change. Left in place deliberately; a human should resolve or overrule.

## Why held (the ONE blocker)

Round-3 `@coderabbitai full review` was requested and **did not run**:

> Action not completed. Review rate limited.

`gh pr checks` shows `CodeRabbit  pass` — that is the BOT succeeding, not a
review. Do not read it as a green gate. Round 1 and round 2 each returned real
MAJOR findings; round 3 has produced nothing yet, and `readImageDimensions()`
is newly-written hand-rolled binary parsing over untrusted input.

**RESOLVED** — the budget reset, rounds 3 and 4 both ran.

Current blocker instead: **12 unresolved review threads (2 MAJOR, 10 Minor)**.
Both MAJORs are answered (one fixed, one disputed with evidence); the 10
Minor are untouched and were explicitly out of scope for the last pass.

Do NOT read `ci=pass · CodeRabbit=pass · MERGEABLE/CLEAN` as review-clean.
`CodeRabbit=pass` means the BOT RAN. `CLEAN` is git mergeability.
`reviewDecision` is still `null`. Check unresolved threads via GraphQL:

    gh api graphql -f query='{repository(owner:"BlackBeltTechnology",
      name:"pi-agent-dashboard"){pullRequest(number:419){reviewDecision
      reviewThreads(first:100){nodes{isResolved isOutdated path line}}}}}'

## Round-4 pass (commit `27dcd5afe`) — all 10 Minor addressed

| Thread | Outcome |
|---|---|
| 7/9 lag monitor final sample | FIXED — and it exposed a VACUOUS P1 (below) |
| 4 attachment gate order | FIXED — session-file gate now precedes shape check; new `X6c` |
| 11 assert pending before terminal | FIXED, adapted — MutationObserver latch, not a racy visibility assert |
| 12 assert every replayed row | FIXED, adapted — virtualization-aware sweep |
| 2/3 design.md D12 + stale cache refs | FIXED (also corrected `attachments/AGENTS.md`, not in the finding) |
| 6 terminal-manager row | FIXED — history dropped, contract facts folded in |
| 10 e2e row order | FIXED — alphabetical + >200-char body promoted to a sidecar |
| 1/8 artifact under `archive/` | STILL DISPUTED — held on user instruction |

### The finding that matters: P1 never tested the offload

`startLagMonitor().stop()` cleared its interval WITHOUT a final sample, so work
that blocked the loop from start to stop let no tick run and measured **0 ms**.

Fixing it turned P1 red at ~900 ms — correctly. Evidence chain:

1. tick trace: 6 ticks, then an unbroken 908 ms gap
2. `fitBlocks` spy: **2 in-process calls** for a `size: 1` pool
3. worker probe: `ONLINE`, then
   `Cannot find module …/display-fit.js imported from …/fit-worker.ts`,
   `EXECARGV` carrying no jiti loader

Under vitest the `.ts` worker entry can never load, so the pool caught the
crash and fell back to MAIN-THREAD fitting for every fit in the suite. P1
passed only because the monitor lied. **Two bugs cancelled out.**

`workerExecArgv()` supplies the loader when the host lacks one. Production is
unaffected (`bin/pi-dashboard.mjs` already passes `--import <jiti-register>`,
which the worker inherits) — this repairs vitest and any embedder. After:
in-process calls **0**, ticks **6 → 63**.

With the monitor honest, P1 is now SELF-GUARDING: a silent fallback blows the
50 ms budget instead of passing. Do not "fix" a future P1 failure by relaxing
the budget without first checking whether the worker actually ran.

Not actioned, worth a follow-up: the fallback is SILENT. Any embedder whose
`execArgv` lacks a TS loader degrades to main-thread fitting with no signal.

### Harness memory ceiling — do NOT chase as a regression

`chat-attachment-two-phase` is 8/8 on a CLEAN container and flaky on a dirty
one. Measured RSS across consecutive full-file runs on the same container:

    504 MiB  →  2.61 GiB  →  3.43 GiB   (cap 4 GiB)

By roughly the third run the container nears its cap and `spawnFreshGitSession`
/ the send loop time out — failures land in SETUP, never in an assertion. Recycle
the harness (`test-down.sh && test-up.sh`) before believing a P5 failure.

Also environmental this pass: `display-fit-perf` P4 (50 MB RSS delta budget)
failed once under full-suite parallelism and passed 2/2 isolated, with identical
code passing in an earlier full run.

### Gate state after this pass

- `npm test` — 12061 passed, 1 environmental failure (P4, above)
- `npm run build` — green
- E2E `chat-attachment-two-phase` — 8/8 twice on a clean harness
- All 9 addressed threads have replies posted; round-5 review requested

## Commits

- `9996095f5` — four MAJOR findings (cache header, pre-decode guard, MIME
  admission, fallback cap) + the `image/jpg` fittable⊆servable reconciliation
- `0eb5f4e9a` — a11y (zoom is a real `<button>`), docs caveman style, spec
  Purpose + two-phase boundary, tasks.md D10 correction
- `77641cf8b` — merge `origin/develop`, two additive doc-index conflicts
- `ca3903734` — repair `pinDirectory` for the AddFoldersDialog rewrite
- `69362948c` — merge `origin/develop` (#422). develop had independently made
  the SAME helper fix; four conflicts resolved by taking the better side
  (see the commit body). Attachment E2E 8/8 twice on the merged tree.
- `0065ed5ee` — merge `origin/develop` (#421). Conflict in `event-wiring.ts`
  was an import block only: develop re-added `ViewedSessionTracker`, already
  sorted to line 31 here, so that copy was a duplicate; `sessionCommandRegistry`
  was genuinely new. Attachment E2E re-run (8/8) because that file sits on the
  ingest path. Did NOT fix the two red specs.

## Gate state

- `npm test` — 11914 passed, 0 failed
- `npm run build` — green
- E2E `chat-attachment-two-phase` — **8/8 green** on the merged tree
- E2E kb-folder-slot / worktree-init-feedback / session-spawn — 5/5 green
- PR — MERGEABLE
- Round-3 review — **NOT RUN (rate limited)**

## Pre-existing failures — do NOT chase as regressions

Attribution was established by building `origin/develop` with ONLY the E2E
helper fix applied and running the same specs against it:

| Spec | this branch | develop baseline |
|---|---|---|
| `inline-screenshot` | fail | fail |
| `scroll-to-top:55` | fail | fail |
| `scroll-to-top:91` | PASS | fail |

Both failures predate this change. `scroll-to-top:91` is better here.

Re-checked after merging develop (#421) on 2026-08-05: **still red, unchanged**.
#421 touches no chat/transcript/tool-render surface, so this was expected.
Do not re-test these hoping a develop merge fixed them — fix them at source or
file them.

Also environmental, not regressions:
- `chat-attachment-two-phase` F8 ("image row keeps its height") failed once
  inside a wider 4-file batch, then passed 3/3 isolated and 8/8 in two
  consecutive single-file batches. Order/state sensitivity from specs sharing
  one container. Re-run isolated before believing an F8 failure.
- `DiagnosticsSection` clipboard-fallback test fails under full-suite
  parallelism, passes 5/5 alone.
- Full 64-spec E2E run OOM-kills the container (`oom=true`, 4 GB limit in a
  7.7 GB VM). Run targeted specs, not the whole suite, on this host.
- `pi-dashboard-bin-wrapper` (`no free port`) and `doctor-route` (3 s budget,
  5.4 s under load) each failed once under full-suite parallelism, pass alone.

## Correction to an earlier claim (commit ca3903734)

That commit message says `pin-directory-dialog` "died with #90" and that
nothing rendered it. **That is wrong.** `PinDirectoryDialog.tsx` still exists
and still renders the testid; it is only no longer what the "Add folder" CTAs
open (it lives under Settings > Packages). The fix itself is unaffected —
`pinDirectory` must target AddFoldersDialog either way — but the stated
reasoning was false. Corrected in the merged helper comment.

Root cause, worth remembering (could NOT be saved to memory — store is full at
10000/10000 and auto-consolidation fails on an API usage limit):

> macOS BSD grep silently matches NOTHING when `--include` comes AFTER the
> search path. `grep -rn PAT dir --include=*.tsx` returns 0 hits while
> `grep -rn PAT dir` returns the real hits. No error, no warning.
> Put `--include` BEFORE the path, or use `git grep` / `rg`. Verify any
> "X exists nowhere" conclusion with a second tool before acting on it.

## Do NOT

Merge while any MAJOR finding is open, or while round 3 has not actually run.
A rate-limited review is an ABSENT review, not a clean one.

## Out of scope

Follow-ups already filed: #415, #416, #417, #418, #420.
Worth filing: `inline-screenshot` + `scroll-to-top:55` are red on develop.
