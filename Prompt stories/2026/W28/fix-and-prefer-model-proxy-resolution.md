---
session: 019f5492
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-and-prefer-model-proxy-resolution]
proposal_excerpt: "The dashboard model proxy cannot resolve any model whose id contains a slash. The route handlers parse the requested model with `modelId.split(\"/\", 2)`, which **truncates** at the first slash instead of splitting on i…"
---

# How we did it: Fix & prefer model-proxy resolution — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash-command:

```
/skill:openspec-apply-change fix-and-prefer-model-proxy-resolution
```

The real objective, spelled out in the attached proposal, was to fix a concrete bug in
the dashboard's model proxy: it **could not resolve any model whose id contains a
slash**. The route handlers used `modelId.split("/", 2)`, which *truncates* at the
first slash instead of splitting on it — so `openrouter/anthropic/claude-3.5-sonnet`
lost its tail. Beyond the fix, the change added **preferred-model** and
**model-alias** support end-to-end (shared config → registry → route resolution →
Settings UI), fully TDD, and then shipped the change through CI to a merged PR. Only
one human turn followed the kickoff — this was a near-autonomous apply→ship run.

## 2. TL;DR playbook

1. **Kick off apply** with `/skill:openspec-apply-change <change>` — the skill reads
   every context file and enumerates the tasks (here: 24 tasks, spec-driven schema).
2. **Read source before writing.** Explore `packages/shared`, the `model-proxy`
   registry, the route handlers, and the Settings UI so you understand the whole
   provider→registry→route→UI path first.
3. **TDD each layer bottom-up.** shared parse helper + config → registry dedup +
   `firstAvailable` → route `resolveRequestedModel` → Settings UI editors. Write the
   failing test, then the minimal implementation, mark tasks green as you go.
4. **Fix the worktree test-resolution trap early.** Add the same
   `resolve.alias` the client vitest config uses to the *server* vitest config, or
   package-name imports of `shared` escape to the main checkout that lacks your new file.
5. **Prove "failures aren't mine."** When the full suite is red, stash + run on base,
   and run your touched packages in isolation, to show the failures are pre-existing
   (image-fit `Jimp`, CPU-load timeout flakes) — not regressions.
6. **Distinguish real tsc errors from worktree false-positives.** Point tsc at the
   worktree `shared` source temporarily to confirm your code is genuinely type-clean.
7. **Scope Biome to your NEW files** (`biome check <files>`), fix only import-sort in
   lines you added; don't chase pre-existing warnings CI's `--changed` won't flag.
8. **Update the AGENTS.md tree rows** for the new + edited files (caveman style).
9. **Ship** with `ship-change`: mark manual-QA tasks deferred, verify gate, sync delta
   spec → main spec, archive, commit, push, open PR against `develop`, watch CI, merge.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read everything first).** Before touching code the AI listed
`packages/shared/src`, grepped for `parseModelProxyConfig`/`ModelProxyConfig`, sized
the route + registry files, and located the Settings UI components. Effective because
this change spans four layers; a partial mental model would have produced churn.

**Phase 2 — TDD bottom-up (shared → registry → routes → UI).** Each task pair was
"failing test, then implementation, then mark green": `parseModelId` (first-slash
split) + config validation for `preferredModels`/`modelAliases`; registry `getAllModels`
dedup-by-fqid + `firstAvailable`; a single shared `resolveRequestedModel` wired into
both `/v1/chat/completions` and `/v1/messages`; then the Preferred-Models and
Model-Aliases editors in `ModelProxySection` with client persistence tests. Working
bottom-up meant every higher layer built on already-green foundations.

**Phase 3 — Worktree resolution debugging (the real time sink).** Two distinct
worktree artifacts surfaced. First, the **server vitest config lacked the
`resolve.alias`** the client config had, so shared imports escaped to the main
checkout — fixed by copying the alias. Second, **tsc reported 6 errors** that were all
the same server→shared package-name import escaping to the checkout lacking the new
file; the AI proved the code was type-clean by pointing tsc at the worktree source and
getting zero errors. Decision point: *don't "fix" false-positives that vanish in CI.*

**Phase 4 — Green-signal hygiene.** The full suite showed ~20 failures. Rather than
assume regression, the AI stashed and ran on base, and ran the three touched packages
in isolation, proving every failure was pre-existing (`Jimp is not a constructor` in
the untouched image-fit extension, plus 5s timeout flakes under parallel CPU load). All
95 model-proxy tests were green.

**Phase 5 — Quality gates + docs.** Biome scoped to new files (fixed import-sort in the
new test file), CodeRabbit review = 0 findings on all 13 files, then AGENTS.md tree
rows updated for the new/edited files. Human turn #2 arrived here: *"I will tests
later, ship-change."*

**Phase 6 — Ship.** The `ship-change` skill marked the two manual-QA tasks deferred,
ran the verify gate, synced the delta spec into `openspec/specs/model-proxy/spec.md`
(ADDED "Model ID resolution", MODIFIED "Settings UI persists…"), archived the change,
committed, pushed, opened **PR #285** against `develop`, watched CI go green (7m47s),
confirmed no actionable CodeRabbit threads, and squash-merged (SHA `9a100ee`) with
branch + worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-and-prefer-model-proxy-resolution`.
  Effective because the proposal already carried the full task list and acceptance
  criteria; the slash-command hands the AI a bounded, spec-driven scope so it can run
  the whole apply loop with almost no further steering. **Reproduce this by writing a
  tight proposal first** (clear bug statement + numbered tasks) so the apply command is
  the only prompt you need.
- **The high-leverage follow-up** — `I will tests later, ship-change`. A seven-word turn
  that (a) explicitly authorized deferring the manual-QA tasks and (b) unlocked the
  entire ship pipeline. Short, decisive, unambiguous about scope. **Rewrite weak
  versions** like "is it done?" into this shape: state the deferral + name the next
  skill in one line.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to complete/verify manual-QA tasks before shipping | "I will tests later, ship-change" | State up front which tasks are manual/deferred so the apply loop doesn't stall on them |
| Trust the raw full-suite red as a regression signal | (self-corrected) stash+base run + isolated package run | Adopt the rule "prove failures are pre-existing before touching them" as a standing convention |
| Treat worktree tsc/vitest resolution errors as real code errors | (self-corrected) alias fix + point tsc at worktree source | Copy the client vitest `resolve.alias` into every package's config when working in a worktree |

Notably this session needed **almost no human correction** — most "steering" was the AI
self-correcting inside the apply loop. The one genuine human turn was the ship
authorization. The lesson: a well-specified proposal + a mature apply/ship skill pair
lets one prompt carry a multi-layer change to a merged PR.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session was a clean *application* of two
existing skills:

- **`openspec-apply-change`** — reads the change's context files, enumerates tasks, and
  drives TDD task-by-task with progress tracking. Effective because it keeps a
  multi-layer change coherent (shared→registry→routes→UI) and marks tasks green only
  when their tests pass. Invoke it whenever a proposal is ready to implement.
- **`ship-change`** — the post-apply pipeline: defer manual QA, verify gate, sync delta
  spec → main spec, archive, commit, push, open PR against `develop`, watch CI, handle
  CodeRabbit, squash-merge + cleanup. Effective because it makes the entire land
  sequence one command with a known exit condition (CI green + no actionable threads).
  Invoke it when implementation is done and only manual/QA tasks remain.

**Worth capturing as a memory** (if not already): *in a worktree, mirror the client
vitest `resolve.alias` into the server vitest config, or shared imports escape to the
main checkout* — this cost real time here and will recur on every worktree change that
adds a new shared file.

## 7. Pitfalls & dead ends

- **Worktree vitest resolution.** Server vitest config lacked the `resolve.alias` → new
  `shared/src/model-id.ts` was invisible to server tests. *Fix:* copy the alias the
  client config already had.
- **Worktree tsc false-positives.** `tsc` resolves the package-name `shared` import to
  the *main* checkout (no uncommitted file) → 6 phantom errors that vanish in CI. *Fix:*
  temporarily point tsc at worktree source to confirm clean; don't "fix" them.
- **Full-suite red ≠ your regression.** ~20 failures were `Jimp is not a constructor`
  (untouched image-fit extension) + 5s timeout flakes under parallel CPU load. *Fix:*
  stash+base run and isolated-package run to attribute failures before acting.
- **Biome whole-file noise.** Running Biome on whole files surfaces pre-existing
  warnings you didn't cause. *Fix:* scope to your NEW files; only import-sort in added
  lines matters (CI runs `--changed`).
- **CodeRabbit rate-limit ACK.** The PR showed "pass / Review rate limited" — a
  placeholder, not a real review. *Fix:* rely on the authoritative full review captured
  during apply (0 findings on the identical diff) + zero inline threads.
- **Worktree branch cleanup collision.** Local `-d` branch delete fails because
  `develop` is checked out in the parent and the squash-merge isn't a fast-forward
  ancestor; the Bash tool was also pinned to the now-removed worktree cwd. *Fix:* run
  cleanup from the parent checkout (or the sandbox executor), force-delete the local
  branch.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A tight OpenSpec proposal (`openspec/changes/<name>/`) with a clear bug statement and
  numbered, TDD-able tasks.
- A worktree for the change; know that server/client vitest configs need the
  `resolve.alias` to see uncommitted shared files.

**Steps:**
- [ ] `/skill:openspec-apply-change <change>`
- [ ] Read all four layers before writing (shared, registry, routes, Settings UI).
- [ ] TDD bottom-up: shared parse+config → registry dedup+`firstAvailable` → route
      `resolveRequestedModel` → UI editors; mark tasks green as tests pass.
- [ ] Add the client `resolve.alias` to the server vitest config (worktree fix).
- [ ] Attribute any red tests: stash+base run + isolated-package run.
- [ ] Confirm tsc clean by pointing it at worktree `shared` source.
- [ ] Biome only your NEW files; fix import-sort in added lines.
- [ ] Update AGENTS.md tree rows for new/edited files (caveman style).
- [ ] `ship-change`: defer manual QA → verify → sync spec → archive → PR to `develop`
      → CI green → squash-merge + cleanup from the parent checkout.

**Artifacts produced:** new `packages/shared/src/model-id.ts` (+ tests); extended
`ModelProxyConfig`/`parseModelProxyConfig`; registry dedup + `firstAvailable`; shared
`resolveRequestedModel` wired into both API routes; Preferred-Models + Model-Aliases
Settings editors; synced `openspec/specs/model-proxy/spec.md`; **merged PR #285** (SHA
`9a100ee`).

---

_Generated from session `019f5492-fef2-7376-946d-0bb04ad0d55d` · `pi-agent-dashboard` · 2026-07-12. Source extract: deterministic facts sheet (stdout)._
