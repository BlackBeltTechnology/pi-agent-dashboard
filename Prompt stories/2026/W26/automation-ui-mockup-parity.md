---
session: 019ef707
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [automation-ui-mockup-parity, redesign-automation-editor-and-board]
proposal_excerpt: "`redesign-automation-editor-and-board` (archived 2026-06-23) shipped the **functional** plumbing — grouped editor, two-level trigger picker, `ModelSelector`, edit/delete/update — but did **not** carry the mockups' vis…"
---

# How we did it: Automation UI mockup parity — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The whole session started with **one line**: `/skill:openspec-apply-change automation-ui-mockup-parity`. No prose, no scope narration — just "apply this pre-planned OpenSpec change." The real objective, unpacked from the change's proposal, was to close the *visual* gap left by a prior change: `redesign-automation-editor-and-board` had already shipped the functional plumbing (grouped editor, two-level trigger picker, `ModelSelector`, edit/delete/update), but the automation **board and editor did not match the mockups**. This change carried the session-card visual language (status rails, dots, barber-pole stripes, neon glow), an editor polish pass, a run **findings count**, and a real **stop-a-run** path (`abortSession` host capability → engine `stopRun` → `/stop` route → client button) — 20 tasks across four packages, TDD throughout. The second and only other human turn was three words: `use ship-change skill`.

## 2. TL;DR playbook

1. **Kick off with the apply skill, not a description:** `/skill:openspec-apply-change <change-name>`. The change is already planned; let the skill drive.
2. **Front-load reading.** Before editing, read the proposal, tasks.md, specs, the mockups, the existing plugin client/server files, and the reference visuals module in one discovery burst.
3. **Work TDD, task-block by task-block.** For each numbered task group: write/adjust the test, run just that file (`HOME=$(mktemp -d) npx vitest run <file>`), make it green, tick the task in tasks.md, move on.
4. **Build server foundation first, UI last:** types → run-store → host capability (`abortSession`) → engine → route → client api → board/editor components. Downstream code then compiles against real signatures.
5. **Isolate each test run** with `HOME=$(mktemp -d)` to dodge hoisted-cache and home-dir pollution across the worktree.
6. **Run the authoritative full gate** (`npm test | tee /tmp/pi-test.log`) and triage failures by package — separate *your* scope from pre-existing environmental noise.
7. **Delegate docs to a subagent** in the project's caveman file-index style, then verify the rows landed.
8. **Hand off to `use ship-change skill`** and let it archive → commit → PR → watch CI → merge → clean worktree, pausing only at genuine judgment calls.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read everything first).** The AI opened the apply skill, ran `openspec status`/`instructions apply`, then read the proposal, tasks, specs, mockups, shared types, server files, the session-visuals reference, and existing tests. ~23 reads + many greps before a single edit. *Why it worked:* a 20-task cross-package change needs the full picture up front; the AI explicitly said "I have a full understanding now" before writing code — no premature edits to unwind later.

**Phase 2 — Server foundation, TDD.** Built bottom-up: findings count in `run-store` (3.1/3.2), then the host `abortSession` capability mirroring the existing `spawnSession` trust gate (4.1/4.2), engine `stopRun` that keeps a stopped run *visible* rather than auto-archiving (4.3), the `/stop` route (4.4), and client `api.ts` `stopAutomationRun` (4.5). Each landed with its own test run in an isolated `HOME`. *Decision point:* the model deliberately made a stopped run finalize with a non-empty result so it stays on the board.

**Phase 3 — Client rewrite.** A full rewrite of `AutomationBoard.tsx` (status rail + dot, headless icon, status pill, barber-pole stripe on running, neon glow/rim on select, per-card last-run summary, mode field, repo crumb) plus a new local `automation-card-visuals.ts`. *Why the replica:* the plugin **cannot import `@client`**, so it re-declares the host's status→FX-class mapping and applies the global FX classes *by name*. Then editor polish in `CreateAutomationDialog.tsx` (bordered group boxes, segmented Scope control, trigger pills + event grid, pulsing next-run dot, armed chip, footer caption).

**Phase 4 — Verify & triage.** A `tsc` pass surfaced one error; the AI correctly diagnosed it as a **cross-worktree module-resolution artifact** (worktree `node_modules` hoists to the *main* checkout, which lacks the edits — but both edits ship together, so it's consistent on merge; vitest uses worktree aliases, which is why tests pass). The full `npm test` showed 17 failures, **all** in the untouched `pi-image-fit` package (old `jimp`, `Jimp is not a constructor`) — flagged as pre-existing/environmental, and CI does a clean install.

**Phase 5 — Ship (steering turn #1).** On `use ship-change skill`, the AI archived + synced specs, committed via a message file, pushed, opened PR #164 against `develop`, and hit two snags (below). It merged after a human OK on the CodeRabbit deferral, then cleaned the branch + worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change automation-ui-mockup-parity`.** Effective because the *planning* was already done in the OpenSpec change; the operator just points the apply skill at it. No need to re-describe scope — tasks.md is the contract. This is the ideal kickoff when a change is already proposed.
- **High-leverage follow-up — `use ship-change skill`.** Three words that unlocked the entire archive→commit→PR→CI→merge→cleanup pipeline. Works because the discipline lives in the skill; the operator only names it at the right moment (all tasks green).
- **Rewrite for a weaker start:** if you *don't* have a planned change, don't open with "make the automation board match the mockups." Instead: "run `/skill:openspec-new-change` to plan mockup parity for the automation board+editor, then apply it" — so the visual targets get pinned in tasks.md before any code.

## 5. Steering & corrections (what to watch for)

Only one explicit human steering turn (`use ship-change skill`), but several *self-corrections* and judgment calls are the real guardrails:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a red full-suite gate as a hard stop | (AI paused, explained the 17 `pi-image-fit` fails are environmental; operator implicitly approved relying on CI's clean install) | State up front: "triage full-suite reds by package; pre-existing failures in untouched packages don't block if CI clean-installs" |
| Read a `tsc` error as a real break | Diagnose it as a worktree-hoist artifact (both edits ship together) | Note the worktree `node_modules` hoists to the main checkout; trust vitest's worktree aliases |
| Want to auto-merge once CI is green | Stop and confirm, because CodeRabbit was rate-limited/credit-exhausted | Convention: CodeRabbit rate-limits are **defer-and-continue, never blocking** — but surface the merge as a human confirm |
| Leave a stopped run archived/empty | Finalize `stopRun` with a non-empty result so it stays visible | Spec the desired post-stop card state in tasks.md |

Also worth internalizing: the AI leaked a stray `oldText2` in one edit and a `mockImplementation` leaked across a test — both caught and fixed the same turn. Watch edit payloads and reset mocks in `beforeEach`.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session **consumed** existing ones:

- **`openspec-apply-change`** — drove the whole implementation from a planned change's tasks.md. Invoke it whenever a change is proposed and you're ready to build; it keeps you honest against the task list.
- **`ship-change`** — the land-it pipeline (verify → archive → commit → PR → CI watch → CodeRabbit → merge → worktree cleanup). Invoke once all tasks are checked and tests are green.
- **`general-purpose` subagent** — the *only* spawn, used to update the `docs/file-index*.md` rows in caveman style per the Documentation Update Protocol. Effective because it isolates the doc write out of the main context and enforces the house style.

*If anything should be captured:* the **worktree-hoist tsc artifact** and the **`pi-image-fit`/`jimp` environmental failure** are recurring enough to deserve a project memory so the next apply session doesn't re-diagnose them from scratch.

## 7. Pitfalls & dead ends

- **CI didn't trigger at first — misread as token suppression.** The real cause was a **`DIRTY` merge state**: a conflict in `docs/file-index.md` (develop had added `session-distiller`; this branch never touched that file). *Fix:* merge `origin/develop`, take develop's version of the index wholesale, re-push — CI then ran.
- **CI round 1 failed on a real type break.** `loader.test.ts` built a `ServerPluginContext` literal missing the newly-required `abortSession`. *Fix:* add the field; note `tsc` reports all errors in one pass, so the single surfaced error was the only break.
- **`pi-image-fit` 17 failures** (`Jimp is not a constructor`) — old hoisted `jimp` vs jimp-v1 constructor in tests. Untouched package; CI clean-installs. *Don't* chase it.
- **Bash tool wedged on a deleted cwd** during cleanup (shell was inside the removed worktree). *Fix:* run cleanup from the **parent** repo, or use the sandbox executor with an explicit cwd.
- **`gh pr merge` errored trying to switch to `develop`** locally (checked out in the parent worktree). The remote merge still succeeded — verify PR state (`gh pr view`) rather than trusting the local error.
- **Plugin can't import `@client`** — replicate the host's status→FX-class map locally and apply global FX classes by name.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a planned OpenSpec change with a complete tasks.md; the mockups referenced by the change; a clean worktree; `gh` authed; awareness that CodeRabbit may be rate-limited.

1. `/skill:openspec-apply-change <change-name>`.
2. Discovery burst: proposal + tasks + specs + mockups + existing plugin files + reference visuals, **before** editing.
3. Server-first, TDD: types → run-store → host capability → engine → route → client api → components. One task-block, one isolated test run (`HOME=$(mktemp -d) npx vitest run <file>`), tick tasks.md.
4. Full gate: `npm test 2>&1 | tee /tmp/pi-test.log`; triage reds by package, separate your scope from environmental noise.
5. Delegate `docs/file-index*.md` updates to a subagent (caveman style); verify rows.
6. `use ship-change skill` — let it archive/commit/PR/CI/merge/cleanup; if CI is `DIRTY`, merge develop and take its index version; add missing type fields on round-2 breaks; treat CodeRabbit rate-limit as defer-and-continue and confirm the merge with a human.
7. Run worktree cleanup from the **parent** repo, not the deleted checkout.

**Artifacts produced:** new `automation-card-visuals.ts` (+ test), `AutomationBoard.tsx`, `routes-stop.test.ts`, `server-context-abort.test.ts`; edits across `automation-types.ts`, `run-store.ts`, `server-context.ts`, `server.ts`, `engine.ts`, `routes.ts`, `index.ts`, `api.ts`, `CreateAutomationDialog.tsx` + tests; archived change; merged PR #164 (squash `232a434f`).

---

_Generated from session `019ef707` · `pi-agent-dashboard` · 2026-06-24. Source extract: `/tmp/facts-1784847629N.md`._
