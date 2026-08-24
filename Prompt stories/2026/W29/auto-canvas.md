---
session: 019f6474
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~15106 tok)"
upgrade_status: pending
openspec_changes: [auto-canvas]
proposal_excerpt: "Today the dashboard's preview surface (the \"canvas\") is reactive: a human clicks a linkified path in tool output, or types /view, and a read-only overlay opens. The rendering half is mature — dispatchPreview()…"
---

# How we did it: auto-canvas — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single skill invocation — the `ship-it` skill fired inside
the change's worktree:

```
<skill name="ship-it" …> Orchestrates the implementation phase of an OpenSpec
change inside its git worktree … Runnable headless.
```

The real objective: take the **`auto-canvas`** OpenSpec change from an empty worktree
all the way to a merged PR — implement a *model-driven* dashboard canvas (the AI
declares what to show via a `canvas()` tool and via write/edit detection, instead of
the human clicking a path), covering **35 automated scenarios (S1–S35)** across four
packages (`shared`/`server`/`extension`/`client`), then run the docker harness, drive
CodeRabbit, and land it. The only human touch after kickoff was one word — `finish` —
to authorize the final squash-merge. Everything between was steered through `ask_user`
decision gates.

## 2. TL;DR playbook

1. **Fire `ship-it` in the worktree.** Let it read the change artifacts + manifest and
   run `filesystemRealityCheck` — confirm *nothing* is implemented (all 35 test files
   absent, tasks unchecked) so the full `apply` runs.
2. **Build the shared foundation first, TDD.** The `shared` package auto-exports
   `src/*.ts`; write the classifier tables (`renderer-by-ext`, `canvas-detect`,
   `canvas-types`, `canvas-declare`) + their unit tests before any wiring. Re-point the
   client to import from shared (re-export for back-compat).
3. **Freeze a protocol contract before delegating.** Author the `canvas()` declare
   normalization + `browser-protocol` messages yourself and write an
   `INTEGRATION-CONTRACT.md` — the boundary both subagents build against.
4. **Delegate the two heavy halves against the contract.** `nodejs-expert` → server
   accumulator + settings reader + REST API; `react-expert` → client lifecycle,
   responsive gate, server chip, CSP threading. Verify each half's tests before
   building the next on top.
5. **Integrate `origin/develop` early and often** (`ship-it` step 2.5). Expect
   conflicts on the exact files you refactored; resolve by *keeping your extraction and
   folding develop's additions into the shared superset*.
6. **Boot the docker harness from a fresh build** (`docker compose build` then
   `test-up.sh`) and run the L3 Playwright canvas specs on the auto-derived port. Fix
   red → green; always tear down the harness after.
7. **Own the security-critical bits yourself.** SSRF probe, CSP idempotency guard,
   two-scope settings writer — do not delegate the trust boundary.
8. **Drive `ship-change` inline through the CodeRabbit loop.** Triage every finding,
   apply the safe ones + add regression tests, re-run CI, distinguish real regressions
   from flakes (re-run flakes, don't chase them). Stop at the squash-merge until told
   `finish`.

## 3. How the collaboration unfolded

**Phase A — Orient & reality-check (08:29–08:31).** The AI read the change design and
`ship-it` scripts, then ran `filesystemRealityCheck` against the manifest: fresh
worktree, all 35 test files absent, tasks unchecked → full `apply` required. It read
the foundational source (`ViewTarget`, server event-wiring call sites, bridge tool
registration, shared exports) before writing a line. *Why it worked:* grounding the plan
in the actual tree, not the spec's assumptions, prevented rework.

**Phase B — Shared foundation, TDD (08:31–09:15).** Section by section: extracted
`RENDERER_BY_EXT`/`RendererKind` into shared and re-pointed the client; wrote
`canvas-detect`, `canvas-types`, `canvas-declare` with unit tests (S1–S8, S13–S15,
S18–S22, S33). Then it **froze the protocol contract** — the declare-normalization +
`browser-protocol` messages — and wrote `INTEGRATION-CONTRACT.md`. *Decision point:* the
human directed "protocol contract first, then delegation," so the AI authored the
boundary itself before spawning any subagent.

**Phase C — Delegate against the contract (09:15–13:30).** `nodejs-expert` built the
server half (accumulator, fresh two-scope settings read, REST API); `react-expert` built
the client half (lifecycle, gate, chip, CSP). The AI verified each half's tests before
proceeding and closed real feature gaps itself (server-side chip-expiry S32). *Decision
point:* the human said "push through" on the remaining L3 gaps rather than shipping a
partial.

**Phase D — Integrate develop + harness (13:30–14:20).** Merged `origin/develop`
(resolved an `App.tsx` union conflict), ran the full unit suite, then rebuilt the docker
image and booted the harness on derived port `18775`. The first L3 run was 10/13 —
three failures (S25/S29/S30) traced to **one root cause**: the confirm-chip expired on
its *own* turn's `agent_end` before it could be tapped. Fix: expire at the *next* turn
boundary. Re-run → 13 passed, 1 fixme; then it made S31 (hung-probe timeout) real with a
Playwright route-delay.

**Phase E — Settings UI + gates (14:00–14:33).** The human wanted the full task 5.2
(the `canvasTypes` settings panel), which needed a new two-scope settings *write* API.
The AI built and unit-tested the writer itself (security-sensitive boundary), delegated
the panel to `react-expert`, then ran the Biome quality gate and fixed a
`no-direct-child-process` guard regression that had ridden in on the develop merge.

**Phase F — Ship-change + CodeRabbit loop (14:40–16:05, then 22:58 finish).** Drove
`ship-change` through a second develop integration (conflict on the *very*
`preview-dispatch` table it had extracted, vs develop's new `docx`/`spreadsheet`/`email`
kinds — resolved by adding the kinds to the *shared* superset), an
`isomorphic-dompurify` install cascade, spec archive fix (`MODIFIED`→`ADDED` delta),
PR #335, CI, and **two rounds of CodeRabbit** (13 findings; a real **Major CSP
idempotency-bypass** hardened + regression-tested). It stopped before squash-merge until
the human said `finish`, then merged (SHA `9aaf7750a`), deleted the branch, and removed
the worktree.

## 4. Prompts that worked

- **The goal prompt** (`ship-it` skill invocation): effective because it handed the AI a
  *complete, self-describing procedure* with a manifest, a defer policy, and a boundary
  contract — the AI never had to guess scope. For a future operator: kick off big
  OpenSpec implementations by invoking `ship-it` in the worktree, not by describing the
  feature freehand.
- **"protocol contract first, then delegation"** — a high-leverage steer. It forced a
  frozen `INTEGRATION-CONTRACT.md` before any subagent ran, so the two parallel halves
  built against a stable boundary and integrated cleanly. Bake this in: *always author
  the cross-package type/protocol boundary yourself before fanning out to subagents.*
- **"push through" / "the user wants the full 5.2"** — short unlocks that told the AI to
  close real feature gaps rather than ship fixme placeholders. Effective because the AI
  had already surfaced an honest real-vs-fixme inventory, so the human could authorize
  the extra scope in one word.
- **"finish"** — the single word that released the squash-merge boundary. The AI had
  parked at exactly the right gate (PR clean + mergeable), so the finish was a no-risk
  one-liner.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Delegate broadly before a boundary existed | "protocol contract first, then delegation" | Author + freeze `INTEGRATION-CONTRACT.md` (types + protocol msgs) *before* spawning subagents |
| Offer to ship with L3 gaps behind `fixme` specs | "push through" | State up front: *no fixme placeholders for real features — close the gap or flag it as genuinely out-of-scope* |
| Treat the settings-panel task (5.2) as skippable ("hand-editable today") | "the user wants the full 5.2" | Decide manual-convenience-vs-required for each task at plan time, not at ship time |
| Pause the whole flow at every decision gate via `ask_user` | Answer 4 gates (contract, push-through, 5.2, stop-before-merge) | For headless runs, pre-declare the policy (e.g. "close all gaps, stop before merge") so gates resolve without a human |

Also note the two integration surprises the human never had to catch — the AI self-caught
them: a merge that reverted a `child_process` allowlist guard, and a develop-side sibling
change to the exact `preview-dispatch` table being refactored. *Guardrail:* after any
`develop` merge on a refactor branch, re-run the guard tests and diff the conflicted files
against develop's post-merge version.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved** (project · tool-quirk): *running `npx vitest run <file>` directly fails
  a test-isolation guard because `HOME` equals the real user home (would touch `~/.pi`
  and could kill live pi sessions) — prefix every vitest invocation with
  `HOME=$(mktemp -d)`.* **Why effective:** it removes a recurring, dangerous foot-gun —
  the whole session used `HOME=$(mktemp -d) npx vitest run …` after learning this once.
  **Invoke when:** running any vitest command in this repo outside `npm test`.
- **Subagents as delegated executors against a frozen contract** (`nodejs-expert` ×1,
  `react-expert` ×3). **Why effective:** the judgment-heavy *boundary* (protocol,
  security, accumulator semantics) stayed with the main agent; the mechanical
  package-local implementation fanned out in isolation, keeping the main context clean.
  **Invoke when:** a change spans packages with a definable interface — write the
  interface, then delegate each side.
- **Recommended skill to create:** none new was needed (the workflow *is* `ship-it` →
  `ship-change`), but the "author-the-contract-then-delegate" move is worth capturing as
  a checklist in the `ship-it` skill itself, since it recurred as the pivotal decision.

## 7. Pitfalls & dead ends

- **Confirm-chip expired too early.** The chip expired on its *own* turn's `agent_end`,
  so S25/S29/S30 all failed with "detached from the DOM". *If you hit a control that
  vanishes before it can be used:* expire it at the **next** turn boundary
  (`agent_start`/abort/termination), not the boundary that created it.
- **Harness runs a stale cached image.** `test-up.sh` reuses a cached image without
  `--build`. *If L3 specs test old behavior:* run `docker compose -f docker/compose.yml
  build` first, then `test-up.sh`.
- **`develop` merge reverted an allowlist guard.** Auto-merge kept the branch's side of a
  `kb-routes` import, reintroducing a banned `node:child_process` import that failed the
  `no-direct-child-process` guard. *If a guard test fails after a merge:* diff the file
  against develop's *post-merge* version — develop may have a later fix your merge didn't
  pick up.
- **Sibling refactor conflict.** develop added `docx`/`spreadsheet`/`email` renderer kinds
  directly in the `preview-dispatch` table the branch had extracted to shared. *Resolution:*
  keep the extraction, add the new kinds to the **shared superset** both consumers derive
  from.
- **Native-dep cascade after merge.** develop pulled in `eml.ts` needing
  `isomorphic-dompurify`, crashing 47 server tests that boot the server. *Fix:* `npm
  install` in the worktree.
- **Spec archive rejected a delta.** A new requirement was placed under `## MODIFIED
  Requirements` but didn't exist in the base. *Fix:* move it to `## ADDED Requirements`,
  and run `openspec archive` **from the worktree** (not the parent repo's stale copy).
- **CI flakes vs real regressions.** Two red CI rounds (`test-up-port-derivation`
  timeout; `EditorSearchPanel` timing) were flakes in files the change never touched.
  *Rule:* if the failing file isn't in your diff and passes locally, **re-run** — don't
  chase it.
- **CSP idempotency bypass.** A `html.includes(policyString)` guard could be defeated by
  attacker text (the policy string in a comment). *Fix:* make the guard
  **position-specific** — check for the exact meta at the computed insertion point, not a
  substring search.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change in a worktree (`.worktrees/os-<change>`,
branch `os/<change>`); docker installed for the L3 harness; `gh` authenticated for the PR
+ CodeRabbit loop.

- [ ] Invoke `ship-it` in the worktree; let it `filesystemRealityCheck` the manifest.
- [ ] Build shared classifiers + tests first (TDD); re-point clients via re-export.
- [ ] **Author + freeze `INTEGRATION-CONTRACT.md`** (protocol + normalization) yourself.
- [ ] Delegate server → `nodejs-expert`, client → `react-expert`, each against the contract; verify each half's tests.
- [ ] Keep SSRF probe, CSP guard, and the settings *writer* in the main agent (trust boundary).
- [ ] Merge `origin/develop` early; after every merge re-run guard tests + diff conflicted files vs develop.
- [ ] `docker compose build` → `test-up.sh`; run L3 canvas specs on the derived port; fix red→green; always tear down.
- [ ] Prefix all direct vitest with `HOME=$(mktemp -d)`.
- [ ] Drive `ship-change`: triage CodeRabbit, apply safe fixes + regression tests, re-run flakes, stop before squash-merge.
- [ ] On `finish`: `gh pr merge --squash --delete-branch`, then remove the worktree.

**Final artifacts:** PR [#335](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/335)
merged to `develop` (SHA `9aaf7750a`); the full model-driven canvas across
`shared`/`server`/`extension`/`client`; all 35 scenarios (20 L1 unit + 15 L3 Playwright)
green; specs archived to `archive/2026-07-15-auto-canvas/`.

---

_Generated from session `019f6474-28d0-7036-8acd-4645bd3da409` · `pi-agent-dashboard/.worktrees/os-auto-canvas` · 2026-07-15. Source extract: `/tmp/facts-1784848562N.md`._
