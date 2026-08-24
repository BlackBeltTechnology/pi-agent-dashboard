---
session: 019f545e
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~10542 tok)"
upgrade_status: pending
openspec_changes: [fix-table-copy-empty-clipboard]
proposal_excerpt: "In chat view, the table \"Copy as Markdown\" / \"Copy as TSV\" buttons copy an empty string. `TableWrapper` computes the copy payload **eagerly during render** (`text={copyMarkdown()}`), but that reader dereferences a ref…"
---

# How we did it: Fix table "Copy" copying an empty clipboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single skill invocation:

```
/skill:openspec-apply-change fix-table-copy-empty-clipboard
```

The real objective: implement an already-planned OpenSpec change that fixes a UI bug
where the chat view's table **Copy as Markdown** / **Copy as TSV** buttons put an empty
string on the clipboard. Root cause (from the proposal): `CopyButton` computed its copy
payload **eagerly during render** (`text={copyMarkdown()}`), dereferencing a ref before
React committed it, so `React.memo` froze `""` and a silent `catch {}` hid the failure.
Two steering turns then expanded the scope from "apply the tasks" to "also add a real
browser E2E test proving the clipboard works" and finally "ship it" — take the change
from red bug to merged PR with the manual QA task converted into an automated gate.

## 2. TL;DR playbook

1. Load `openspec-apply-change` for the change; read `proposal.md` + `tasks.md`, then
   `grep` every `CopyButton` call site before touching code.
2. **TDD first:** add click-level tests asserting real table md/TSV lands in the
   clipboard; run them with an ephemeral `HOME=$(mktemp -d)` and confirm they fail (`""`).
3. Change the contract: `CopyButton` prop `text: string` → `getText: () => string`;
   call `getText()` at click time, deps `[getText]`.
4. Migrate **all** call sites (`MarkdownContent`, `ChatView`, `SkillInvocationCard`,
   `SessionBanner`) + the existing `CopyButton.test.tsx`; `grep` for zero remaining
   `text=` on `CopyButton`; run `tsc --noEmit`.
5. Keep the diff **surgical** — if `biome --write` reorders imports, revert the churn
   and keep only functional lines. Isolate pre-existing failures (jimp, browse-endpoint)
   from your own.
6. Convert manual QA (task 5.1) into a Playwright E2E: add a faux scenario
   (`copy-surfaces`) streaming a table + code fence, then a spec that grants clipboard
   permission and reads back the **real** clipboard.
7. Run E2E via the **fast path** — build/boot the Docker harness manually on a pinned
   port (`test-up.sh`), then attach with `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`
   (the managed run's 180s health cap can't absorb a cold image build).
8. `ship-change`: verify gate → archive + sync specs → commit → PR → watch CI →
   resolve conflicts → re-run flaky CI → confirm 0 CodeRabbit threads → squash-merge →
   delete branch → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & TDD (apply the change).** The AI loaded the apply skill, read
the proposal and every `CopyButton` consumer, then wrote failing click-level tests
*before* implementation. The effective move: it proved the bug red first
(`HOME=$(mktemp -d) npx vitest run …`) so the later green run was meaningful. It then
did the ref→callback contract flip and migrated every call site in one pass, guarding
`skill.args` with `?? ""` for strict-null.

**Phase 2 — Surgical cleanup.** `biome --write` auto-reordered imports across four
files. The AI recognized this as churn unrelated to the prop rename and **reverted the
import reordering**, keeping the diff purely functional. It separated the repo's 18
pre-existing test failures (jimp native resize in `pi-image-fit-extension`, one
`browse-endpoint` `node_modules` listing) from its own domain (client suite: 0 failures).

**Phase 3 — E2E gate (steering #1).** The human asked whether the remaining manual task
could become a Playwright test. The AI investigated first (found the faux-model
`[[faux:<id>]]` sentinel infra + `mermaid-colorize.spec.ts` as a template), then added a
`copy-surfaces` faux scenario and a spec reading the real clipboard. The E2E caught two
real bugs mid-development: a **streaming race** (table clicked before rows finished
streaming) fixed by waiting for the code block's "Copy code" button, and a
**user/assistant scoping** bug fixed with `.last()`.

**Phase 4 — Ship (steering #2).** `ship-change` drove verify→archive→PR→merge. Decision
points the human implicitly delegated: confirming the 18 local failures were
environmental by checking develop's CI was green; repairing a pre-existing corrupted
main spec (leaked `## ADDED Requirements` header + missing `## Purpose`) that blocked the
sync; resolving a `qa/AGENTS.md` merge conflict as a union of both rows; re-running flaky
`EditorFileTree` CI; and completing a server-side merge even though local worktree
cleanup errored.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-table-copy-empty-clipboard`.
  Effective because the change was already planned: proposal + tasks existed, so the AI
  had a spec to execute against rather than inventing scope. *Lesson: front-load the
  OpenSpec change so "apply" is unambiguous.*
- **High-leverage follow-up #1** — *"Is it possible to implement e2e playwright tests
  with system browser to check the remaining tasks?"* A single open question that turned
  a deferred manual step into an automated gate. It worked because it asked *whether*
  (inviting the AI to investigate feasibility) rather than dictating *how*.
- **High-leverage follow-up #2** — `ship-change`. One word that triggered the full
  land-the-PR workflow. Works only because the project ships a `ship-change` skill; the
  operator just names it.
- Stronger rewrite of #1 for next time: *"Convert manual task 5.1 into a Playwright E2E
  against the docker harness using a faux scenario, and read back the real clipboard."*
  — states the pattern up front, skipping the feasibility round-trip.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the manual QA task as "deferred to ship" | Asking if it could be a real E2E test | Stating up front that browser QA tasks become Playwright specs (project pattern) |
| Let `biome --write` reorder imports (churn) | (self-corrected) revert non-functional changes | Enforcing the surgical-changes rule; run `biome check` without `--write` first |
| Risk conflating 18 environmental failures with its own | Verifying develop's CI is green as ground truth | Checking `gh run list --branch develop` before trusting local red |
| Use the managed E2E run (180s health cap) that times out on cold build | Switch to the fast path: manual `test-up.sh` + `PW_E2E_USE_RUNNING=1` | Documenting the fast path as default for first-run/worktree E2E |
| Click copy buttons mid-stream (partial clipboard) | Wait for the code block's "Copy code" button before asserting | Gating clipboard reads on stream-complete signals |

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved** (project · tool-quirk): the CI-flaky `EditorFileTree.test.tsx` pair
  (`scrollIntoView` spy + `waitFor` timeout) that passes locally but reds intermittently
  in CI. *Effective because* the next ship can immediately recognize these failures as
  flaky and reach for `gh run rerun --failed` instead of investigating a phantom
  regression — it removes a ~10-minute diagnosis loop.
- **Faux scenario `copy-surfaces`** (`qa/fixtures/faux-scenarios.ts`) — a reusable
  no-LLM fixture streaming a GFM table + fenced code block, exercising all four copy
  surfaces in one memoized render. Invoke it from any future clipboard/table E2E.
- **E2E spec `tests/e2e/table-copy.spec.ts`** — the template for "read the real
  clipboard after a click" (grant `clipboard-read`/`clipboard-write`, wait for
  stream-complete, `navigator.clipboard.readText()`).
- *Recommended new skill:* a "run-dashboard-e2e-local-changes fast path" note already
  exists; consider a companion capturing the **clipboard-assertion pattern** (permission
  grant + stream-complete wait + `.last()` scoping) so it isn't re-derived.

## 7. Pitfalls & dead ends

- **Empty clipboard from eager render:** if a `CopyButton` copies `""`, the payload is
  being computed at render (`text={fn()}`) and frozen by `memo`. Fix with a
  `getText: () => string` callback invoked at click time.
- **`biome --write` churn:** it reorganizes imports (an assist, not a CI error). Revert
  the reordering; keep only functional diff lines.
- **`quality:changed` processes 0 files in a worktree:** VCS-comparison quirk. Run
  `biome check` directly on your changed files plus `tsc` to satisfy the gate substance.
- **Managed E2E times out (container not healthy in 180s):** it's doing a cold Docker
  build. Use the fast path — `test-up.sh` on a pinned port, then `PW_E2E_USE_RUNNING=1`.
- **Streaming race in E2E:** asserting on a table the moment it's visible captures a
  partial table. Wait for the last-streamed element (code block's "Copy code" button).
- **`"Copy as plain text".first()` matches the user bubble:** the user prompt has copy
  buttons too. Use `.last()` for the assistant message.
- **PR `mergeStateStatus: DIRTY` blocks CI:** merge `develop`, resolve conflicts (union
  the `qa/AGENTS.md` rows), push — CI only starts once `MERGEABLE`.
- **Corrupted main spec blocks `openspec archive`:** a leaked `## ADDED Requirements`
  header (should be `## Requirements`) + missing `## Purpose` in
  `openspec/specs/content-copy/spec.md`. Fix in place (not under `docs/`).
- **`gh pr merge` errors on worktree branch collision:** it tries to update the local
  `develop` checked out in the parent worktree. The **server-side merge still
  completes** (state `MERGED`) — verify, then delete the remote branch and remove the
  worktree manually with an explicit valid cwd.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change (`proposal.md` + `tasks.md`), Docker
running, system Chrome (`PW_CHANNEL=chrome`), `gh` authed, worktree on a branch off
`develop`.

- [ ] `/skill:openspec-apply-change <change>`; read proposal + grep all call sites.
- [ ] TDD: failing click-level clipboard tests (`HOME=$(mktemp -d)`), confirm red.
- [ ] Flip `text: string` → `getText: () => string`; migrate every call site + tests.
- [ ] `grep` zero remaining `text=` on `CopyButton`; `tsc --noEmit` clean.
- [ ] Keep diff surgical; revert any `biome --write` import churn.
- [ ] Isolate pre-existing failures (jimp, browse-endpoint) via develop's green CI.
- [ ] Add faux `copy-surfaces` scenario + `tests/e2e/table-copy.spec.ts`; add AGENTS rows.
- [ ] E2E fast path: `test-up.sh` on pinned port → `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`.
- [ ] `ship-change`: verify → archive+sync → PR → resolve conflicts → re-run flaky CI →
      confirm 0 CodeRabbit threads → squash-merge → delete branch → remove worktree.

**Final artifacts produced:**
- `packages/client/src/components/CopyButton.tsx` (getText contract)
- `packages/client/src/components/{MarkdownContent,ChatView,SkillInvocationCard,SessionBanner}.tsx`
- `packages/client/src/components/__tests__/{CopyButton,MarkdownContent}.test.tsx`
- `qa/fixtures/faux-scenarios.ts` (`copy-surfaces`) · `tests/e2e/table-copy.spec.ts`
- `openspec/specs/content-copy/spec.md` (repaired + synced) · PR #276 (merged `cfa68e04d`)

---

_Generated from session `019f545e-a356-7482-a68f-746cd2a00d62` · `pi-agent-dashboard` · 2026-07-12. Source extract: session-facts for fix-table-copy-empty-clipboard._
