---
session: 019f635a
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-seek-to-session-card]
proposal_excerpt: "When a session is open in `ChatView`, its card in the sidebar `SessionList` is often buried behind one or more collapsed containers — a collapsed workspace tier, a collapsed folder group, and/or a collapsed \"ended\" su…"
---

# How we did it: Add "Seek to Session Card" — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened not with a feature request but with an **orchestration skill invocation**: the first prompt was the entire `ship-it` SKILL body, dropped in to run the *implementation phase* of an already-planned OpenSpec change (`add-seek-to-session-card`) from inside its git worktree. The real objective, once the skill context is unpacked: **implement, test, review, and ship end-to-end** a desktop-only "Seek" button in `SessionHeader` that reveals the currently-open session's card in the sidebar `SessionList` — even when that card is buried behind a collapsed workspace tier, a collapsed folder group, and/or a collapsed "ended" subsection. The only human steering turn in the whole session was two words: **"archive too"**.

## 2. TL;DR playbook

1. **Kick off with the skill, not a description.** Paste the `ship-it` SKILL as the goal prompt from *inside the change's worktree* — it self-orients from the OpenSpec artifacts.
2. **Read the plan before touching code.** Have the AI read `proposal.md`, `design.md`, `tasks.md`, and the `test-plan.md` manifest to learn the scenario levels (here: all 14 automated rows were **L1 vitest**, so *no docker harness* was needed).
3. **Merge `origin/develop` first** (step-2.5 guardrail: remote ref, `--no-edit`, never rebase) while the tree is clean.
4. **Map integration points before editing** — grep the large files (`SessionList.tsx`, `App.tsx`, `SessionHeader.tsx`) for the exact props/state/CSS hooks; read test exemplars to mirror render/mock glue.
5. **Implement bottom-up:** shared `Toast` extension → `App.tsx` state (`revealRequest {sessionId, nonce}`) → `SessionHeader` button → the core reveal machinery in `SessionList` → CSS flash animation.
6. **Typecheck before writing tests;** then author L1 vitest specs that encode the real DOM model (collapsed-workspace → cards absent; collapsed-folder → present 0-height; ended → absent unless expanded).
7. **Run the full quality gate:** `npx tsc --noEmit`, `npx biome check`, `npm test` — and *prove* any failures are pre-existing/unrelated by diffing against the develop base.
8. **Drive `ship-change` inline:** defer manual tasks, archive (`archive too`), commit, push, open PR, watch CI, triage CodeRabbit, apply only the *valid* findings, re-push, squash-merge, delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (03:23–03:24).** The AI read the change artifacts and immediately extracted the decisive fact: all 14 automated scenarios were **L1 vitest**, not L3, so the docker harness was irrelevant for the happy path. This single classification saved a whole test-infrastructure detour.

**Phase 2 — Map before editing (03:24–03:28).** Instead of reading whole files, the AI grepped the large `SessionList.tsx` for state names, the `card-ring-fx`/`data-session-id` flash mechanism, the workspace/folder collapse predicates, and existing test harness exemplars. It merged `origin/develop` up front while the tree was clean.

**Phase 3 — Implement bottom-up (03:28–03:31).** Shared `Toast` first (add optional `action {label,onClick}` + `noAutoDismiss`, back-compatible), then `App.tsx` reveal state, then the `SessionHeader` desktop-only button, then the core reveal machinery in `SessionList`, then a reduced-motion-aware `card-seek-flash` CSS animation.

**Phase 4 — Encode the DOM reality in tests (03:31–03:42).** The pivotal discovery: **collapsed folders don't render card bodies, and folders with only ended sessions aren't rendered at all.** The AI probed the actual render output (even writing throwaway `zz-dbg.test.tsx` files) to learn presence semantics, then wrote 22 specs using a *height-based presence predicate* rather than `offsetParent`. Two initial failures (duplicate `#alpha` text, absent ended-only folder) were root-caused and fixed by scoping the query and adding an active sibling.

**Phase 5 — Quality gate & ship (03:42–04:27).** Biome/tsc/tests clean on touched files; the AI carefully proved the 17 `pi-image-fit-extension` Jimp failures were pre-existing/environmental. Then it drove `ship-change` inline: archive (the human's "archive too"), PR #327, CI watch, CodeRabbit triage (3 valid fixes applied, 4 archive "forbidden subdirectory" flagged as documented false positives), squash-merge `810e795`, and worktree teardown — even recovering when the shell was pinned to the just-deleted worktree dir by finishing cleanup via the sandbox executor.

## 4. Prompts that worked

- **The goal prompt** = the full `ship-it` SKILL body pasted from inside the worktree. This works because the skill is self-orienting: it names its preconditions, its compose-chain (`openspec-apply-change` → docker harness → `ship-change`), and its decision scripts. **Lesson: for a planned change, the strongest kickoff is the orchestration skill itself, launched from the correct worktree — not a re-description of the feature.**
- **High-leverage follow-up:** `"archive too"` — two words that extended scope from "implement + verify" to "archive the OpenSpec change as part of shipping." A tiny prompt that unlocked the entire tail of the ship pipeline.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implement + verify | `"archive too"` | State "implement **and archive**" in the goal, or let `ship-it` own archival by default |
| Trust CodeRabbit blindly | (implicit quality bar) — AI self-triaged: applied 3 valid, rejected 4 archive-path false positives with a documented reply | Encode the archive convention (`openspec/changes/archive/YYYY-MM-DD-<change>/`) so the reviewer bot doesn't re-flag it |
| Assume test failures are its own | AI proactively diffed against develop base to prove `pi-image-fit` Jimp failures were pre-existing | Always pin "is this failure on the base branch too?" before claiming a regression |

The near-total absence of steering here is itself the lesson: **a well-planned OpenSpec change + a self-orienting ship skill = near-autonomous execution.** The human's only input was a scope nudge.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the value came from *composing existing ones*:

- **`ship-it`** — orchestrates the worktree implementation phase; its manifest/no-weakening scripts (`parseManifest`, `deferDecision`, `filesystemRealityCheck`, `assertNoWeakening`) gate progress on filesystem reality, not vibes.
- **`ship-change`** (driven inline) — the archive → commit → PR → CI-watch → CodeRabbit → merge → teardown tail.

**Recommended skill to create:** a small "prove-failure-is-pre-existing" checklist skill — the maneuver of diffing a red test against the develop base to distinguish a real regression from environmental noise (here, `pi-image-fit` Jimp) recurred and is worth codifying.

## 7. Pitfalls & dead ends

- **Collapsed-container DOM model is non-obvious.** Collapsed workspace → cards *absent*; collapsed folder → cards *present but 0-height*; ended group → *absent unless expanded*; folder with only ended sessions → *not rendered at all*. If a reveal test fails on a "missing" card, check which collapse mode you're in before assuming a bug. Use a **height-based presence predicate, not `offsetParent`**, so a `grid-rows:0fr` row never false-positives.
- **`mktemp` template collision / pinned shell.** The final worktree teardown left the bash tool's CWD pointing at the deleted worktree dir. Fix: run remaining cleanup via the sandbox executor (which runs from its own dir) instead of the pinned bash session.
- **CodeRabbit false positives on archive paths.** It flagged `openspec/changes/archive/...` as a "forbidden subdirectory" — this is the repo's *correct* archive convention. Reply-document and skip; don't "fix" it.
- **Environmental test noise.** 17 `pi-image-fit-extension` Jimp failures are present on `develop` too and resolve on a fresh CI install — don't let them block a clean local ship.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the planned OpenSpec change in its worktree (`.worktrees/os-<change>/`), a clean tree, `origin/develop` fetchable, `gh` authenticated for the PR.

- [ ] Launch `ship-it` from inside the change's worktree.
- [ ] Read `proposal.md` / `design.md` / `tasks.md` / `test-plan.md`; note scenario levels (L1 vitest vs L3 docker).
- [ ] `git merge --no-edit origin/develop` (never rebase).
- [ ] Grep integration points + read test exemplars before editing.
- [ ] Implement bottom-up (shared component → app state → button → core machinery → CSS).
- [ ] `npx tsc --noEmit` clean, then author L1 specs encoding real collapse DOM semantics.
- [ ] Full gate: tsc + `biome check` + `npm test`; prove any red is pre-existing vs the base.
- [ ] Inline `ship-change`: defer manual tasks → **archive** → commit → push → PR → CI watch → CodeRabbit triage (apply valid, document false positives) → squash-merge → delete branch + worktree.

**Final artifacts:** PR #327, squash `810e795` merged to `develop`; 22 new L1 vitest specs; edits to `Toast.tsx`, `App.tsx`, `SessionHeader.tsx`, `SessionList.tsx`, `index.css`.

---

_Generated from session `019f635a-bece-7bbd-9f77-f34c213b9736` · `pi-agent-dashboard` · 2026-07-15. Source extract: session facts sheet for `add-seek-to-session-card`._
