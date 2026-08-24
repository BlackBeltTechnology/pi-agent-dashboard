---
session: 019f34c3
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-history-loading-false-empty-flash]
proposal_excerpt: "Selecting a session card that clearly has context (e.g. 159k tokens, 1h+ runtime) renders the \"No messages yet\" placeholder while history is still loading — sometimes after ~15s, sometimes flashing before partial hist…"
---

# How we did it: fix-history-loading-false-empty-flash — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single skill invocation:

```
/skill:openspec-apply-change fix-history-loading-false-empty-flash
```

The real objective: **implement an already-specced OpenSpec change end-to-end, then land it.** The bug being fixed is a UI defect — selecting a session card that obviously has history (159k tokens, 1h+ runtime) flashes a "No messages yet" placeholder while events are still hydrating. The change proposal already existed with `proposal.md`/`tasks.md`/delta spec; the job was to execute the 23 tasks, satisfy every quality gate, and (via later steering) ship it as a merged PR — while correctly *not* getting blocked by a pre-existing red `develop`.

## 2. TL;DR playbook

1. **Kick off with the apply skill:** `/skill:openspec-apply-change <change-name>`. Let it read `proposal.md` + `tasks.md` + the delta spec first — full context before the first edit.
2. **Implement in spec order**, smallest layer first: shared constants/helper (`loading-history.ts`) → callers (`App.tsx`, `useMessageHandler.ts`) → server (`subscription-handler.ts`). Reuse the existing wire signal — do **not** add a new protocol message.
3. **Write the tests alongside the code** (client re-arm suite + server heartbeat suite), then run **only the two touched suites** with `HOME=$(mktemp -d) npx vitest run <files>` to prove them green fast (27 pass).
4. **Update docs + tasks:** edit the three `AGENTS.md` rows for touched files, then `sed -i '' 's/^- \[ \]/- [x]/'` the `tasks.md`, then `openspec validate <change> --strict`.
5. **Run the gates, then isolate noise:** `npm run quality:changed` under-detects in a worktree → run `biome check --write` directly on the changed files, `tsc --noEmit`, and full `npm test`. **Grep failures to prove they're pre-existing** in untouched packages, not yours.
6. **Switch to shipping:** load `ship-change`. Before pushing, check `develop`'s own CI with `gh run` — if the base is already red on unrelated tests, that changes the plan.
7. **Sync + archive:** delegate the delta→main spec sync to a subagent, `openspec validate --strict`, then archive to `openspec/changes/archive/<date>-<change>`.
8. **Commit via a message file** (`git commit -F /tmp/commit-msg.txt`) to dodge backtick shell substitution, push, open the PR with `gh pr create --body-file`.
9. **Merge + manual cleanup:** `gh pr merge --squash --delete-branch` merges *remotely* even when its local branch-switch sub-step fails inside a worktree. Verify `merged:true` via `gh pr view`, then finish cleanup from the **parent** repo with an explicit cwd.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the spec, map the code).** The AI read `proposal.md`, `tasks.md`, the delta spec, then grepped for the existing loading-history plumbing (`loadingHistory`, `clearLoadingHistory`, `event_replay`, `15000`, `setInterval`) across client and server. *Why it worked:* it built a complete mental model of the existing `event_replay { events: [], isLast: false }` marker **before** editing, which is what let it fix the bug with zero new protocol surface.

**Phase 2 — Implement (layered, constants first).** Ten edits, bottom-up: constants + `rearmLoadingHistory()` helper → `App.tsx` arming the short `SUBSCRIBE_ACK_MS` window → `useMessageHandler.ts` re-arm guard → server `setInterval` heartbeat. *Decision point (design):* compose two layers over **one shared signal** (the empty non-terminal marker) rather than invent a new message — no wire-schema change.

**Phase 3 — Test (touched suites only).** Wrote the client re-arm tests and server heartbeat tests, matching each existing suite's harness/style. First vitest run hit an env issue; re-running with `HOME=$(mktemp -d)` isolated it → 27 pass.

**Phase 4 — Gate + noise isolation.** `quality:changed` returned 0 changed (worktree git-detection blind spot), so the AI ran biome/tsc/test directly. The crucial move: every failure was **grep-triaged** and attributed to pre-existing breakage (`image-fit-extension` Jimp imports, `event-reducer` streaming order, a 251ms-vs-250ms perf smoke) in packages the diff never touched.

**Phase 5 — Ship, with a base-is-red decision.** On `use ship-change skill`, the AI checked `develop`'s latest CI run and found it **already failing** on the same `event-reducer` assertion. *Decision point (human-facing):* it surfaced that ship-change's "loop until CI green" gate is unsatisfiable against a red base, and chose **push + open PR, no merge** rather than force-green or merge into red.

**Phase 6 — Merge + cleanup.** Second steering (`maybe the monitoring not necessary`) authorized skipping the CI-watch loop. The AI squash-merged; the local branch-switch failed (worktree pitfall), it verified `merged:true` remotely, then cleaned up branch + worktree from the parent repo.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change fix-history-loading-false-empty-flash`.** Effective because the change was already specced: one skill invocation handed the AI the full task graph (tasks.md) and acceptance criteria (delta spec). *Stronger version for a fresh operator:* same command — but only after confirming `proposal.md`/`tasks.md` exist and are complete; if not, run the propose/plan skills first.
- **High-leverage follow-up — `use ship-change skill`.** Four words that transitioned implement→ship without re-explaining anything. The skill carried all the archive/sync/PR discipline.
- **High-leverage follow-up — `use ship-change skill, maybe the monitoring not necessary`.** Unblocked the merge by explicitly waiving the CI-watch loop, which was stuck on an unrelated red base. *Why it's strong:* it names the exact step to skip, so the AI didn't have to guess how much of the pipeline to shortcut.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Finish `apply` and stop at "implementation complete" | `use ship-change skill` | Chain apply→ship in the kickoff ("apply then ship this change") |
| Hold at "PR opened, not merged" when the base CI was red | `use ship-change skill, maybe the monitoring not necessary` | State the base-red policy up front: "if `develop` is pre-existing-red on unrelated suites, merge anyway once my own tests pass" |
| Treat every red test as potentially mine | (self-corrected via grep triage) | Make "grep-attribute failures to touched packages before blaming the diff" a standing gate rule |

The quality bar the user implicitly imposed: **never force a green by marking/skipping real work, and never silently merge into a red base** — the AI honored this by surfacing the decision instead of guessing.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work was *driven by* existing project skills:

- **`openspec-apply-change`** — turns a specced change into an ordered implementation loop with built-in gates (validate, quality, tsc, test, code-review). Invoke when a change has a complete `tasks.md`.
- **`ship-change`** — the archive→sync→commit→PR→merge→cleanup pipeline. Invoke once implementation gates pass.
- **general-purpose subagent** — used once to sync the delta spec into the main spec in isolation, per ship-change's delegation rule.

*Worth capturing as a skill/memory:* the **base-is-red decision protocol** — "when `develop`'s CI is pre-existing-red on suites your diff never touches, prove non-involvement by grep, then push+PR and merge on explicit human waiver." This recurred as the session's central judgment call and would save the next operator from re-deriving it.

## 7. Pitfalls & dead ends

- **`quality:changed` reports 0 in a worktree.** Biome's `--changed` git-detection under-counts across worktree boundaries. *Fix:* run `biome check --write` directly on the explicit file list.
- **First vitest run flaked on env.** *Fix:* prefix with `HOME=$(mktemp -d)` to get a clean isolated home.
- **Backticks in the commit message triggered shell substitution.** *Fix:* write the message to `/tmp/commit-msg.txt` and `git commit -F`. Same trick with `gh pr create --body-file`.
- **`gh pr merge --squash --delete-branch` "fails" in a worktree.** The remote merge actually **succeeds**; only the local branch-switch sub-step errors because `develop` is checked out in the parent. *Fix:* verify with `gh pr view --json merged` (expect `true`), then delete branch + remove worktree from the **parent** repo with an explicit cwd.
- **Shell cwd left dangling** after `git worktree remove` deleted the directory you were standing in. *Fix:* run the final cleanup commands with an explicit `cd "$parent"`.
- **Don't let a pre-existing red base block you.** ship-change's "loop until CI green" is unsatisfiable against a broken `develop`; grep-triage proves your suites pass, then merge on human waiver.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a complete OpenSpec change (`proposal.md` + `tasks.md` + delta spec) in a worktree; `gh` authenticated; knowledge of which pre-existing suites are red on `develop`.

**Checklist:**
- [ ] `/skill:openspec-apply-change <change>` — read spec + tasks first.
- [ ] Implement bottom-up: constants/helper → callers → server; reuse existing wire signal.
- [ ] Write the touched test suites; run `HOME=$(mktemp -d) npx vitest run <files>` → green.
- [ ] Update the `AGENTS.md` rows; check all tasks; `openspec validate <change> --strict`.
- [ ] Gate: `biome check --write <files>`, `tsc --noEmit`, `npm test` — grep-triage every failure to untouched packages.
- [ ] `use ship-change skill`; check `develop` CI health with `gh run` first.
- [ ] Subagent-sync delta→main spec; `validate --strict`; archive to `openspec/changes/archive/<date>-<change>`.
- [ ] `git commit -F msg.txt`; push; `gh pr create --body-file`.
- [ ] `gh pr merge --squash --delete-branch`; verify `merged:true`; finish cleanup from the parent repo.

**Final artifacts produced:** PR #246 (merged, squash `f001918` into `develop`); 6 code files + 2 test files edited; 3 `AGENTS.md` rows; synced `openspec/specs/chat-history-loading-indicator/spec.md`; archived change dir.

---

_Generated from session `019f34c3-f544-7f47-acaa-a27e7bb586f6` · `pi-agent-dashboard` · 2026-07-06. Source extract: `/tmp/facts-68332-9923.md`._
