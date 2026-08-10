---
session: 019f5855
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-ctx-running-render]
proposal_excerpt: "`CtxToolRenderer` describes a `ctx_*` tool call only from its **result** text (`parseCtxResult`). While a call is still running there is no result, so:"
---

# How we did it: fix the ctx_* running-state card render — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change fix-ctx-running-render`.
The *real* objective, hidden in the change's proposal, was a UI-correctness fix: the dashboard's
`CtxToolRenderer` only knew how to describe a `ctx_*` tool call from its **result** text
(`parseCtxResult`). While a call was still *running* there was no result yet, so the card fell back
to a bare `Running…` and a header chip that just duplicated the tool-name subtitle. The apply had
to (a) derive the header chip from the call **args** instead of the result, (b) render a real
running-state preview, and — once the human added scope — (c) prove the fix end-to-end in a real
browser through the live WebSocket pipeline, then ship it.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` — let it read `proposal.md` + `design.md` + the target file + existing tests before touching code.
2. Implement the two production edits in `CtxToolRenderer.tsx`: an `argsChip(toolName, args)` helper (mirror the result-chip emoji vocabulary) and a `RunningPreview` component; swap the `headerChip` default arm to `argsChip(...)`.
3. Add a **chip ≠ subtitle regression guard** to `CtxToolRenderer.test.tsx` plus running-state preview assertions; run the scoped vitest until green.
4. When asked for an e2e: study the repo's faux-model pattern (`[[faux:<id>]]` → `qa/fixtures/faux-scenarios.ts`) and the WS-frame-drop freeze technique (`superseded-heal.spec.ts`) **before** writing the spec.
5. Add a `ctx-batch-running` faux scenario, then a Playwright spec that drops `tool_execution_end` (+ 404s reconcile) to freeze the card running, PATCHes `generic:true` tool visibility, expands the collapsed member step, and asserts the args chip + `RunningPreview`.
6. Boot ONE standalone Docker container on an explicit port, wait for `/api/health`, then attach the system browser via the `PW_E2E_USE_RUNNING=1` fast path — do NOT let the cold-build 180s health gate in `docker/test-up.sh` block you.
7. `ship change`: run the verify gate, triage failures against the base branch, `openspec archive`, commit with `-F`, push, open PR against `develop`, wait for CI + a *real* CodeRabbit review, squash-merge, clean up worktree.

## 3. How the collaboration unfolded

**Phase A — Apply the change (Discovery → Implement → Test).**
The AI loaded the apply-change skill, read the proposal/design/target/tests, then made the two
production edits and added tests in one pass. `argsChip` derives `▦ N cmds` / `⚙ <lang>` /
`🔍 N queries` / `🌐 <host>` / `🗂 <source|path>` from args; `RunningPreview` replaces the bare
`Running…` with a per-tool body. 41 unit tests green, `openspec validate` clean, 13/14 tasks done
(only the manual smoke test deferred). *Why it worked:* reading proposal + design + existing tests
first meant the emoji vocabulary and the chip/subtitle duplication bug were understood before any
edit — the fix landed coherent on the first try.

**Phase B — E2E through the real pipeline (the steered addition).**
The human added scope: *"Create e2e test with docker test and playwright with system browser."*
The AI resisted writing a spec immediately and instead reverse-engineered the harness: the faux-model
sentinel flow, the `routeWebSocket` frame-drop technique used to freeze a card in `running`, the
tool-visibility PATCH, and how faux tool args reach the renderer. Only then did it add the faux
scenario + spec. *Why it worked:* the running window it needed to assert exists only while a frame is
withheld — understanding the freeze mechanism first was the whole game.

**Phase C — Ship (verify → archive → PR → merge → cleanup).**
`ship change` ran the full verify gate, hit 19 failures, and correctly triaged **all** as
pre-existing/environmental (jimp/Node-v24 + timing flakes) by diffing against `origin/develop` and
confirming develop's own CI was green. Then `openspec archive` (with a delta-header reconciliation),
commit via `-F`, PR #288, CI green (9m54s), a real CodeRabbit full review (0 actionable), squash-merge,
and worktree teardown.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change fix-ctx-running-render`.** Effective because the
  proposal/design/tasks were already written; the skill supplies the "read everything first, then
  implement against tasks.md" discipline. A future operator should ensure the change artifacts are
  complete *before* invoking apply, so the AI has a spec to build against.
- **High-leverage follow-up — "Create e2e test with docker test and playwright with system browser."**
  Short, but it named the three constraints that mattered: real Docker harness, Playwright, *system*
  browser (not bundled). Stronger version: add "freeze the card in running state via the WS
  frame-drop technique like superseded-heal.spec.ts" to point straight at the mechanism.
- **High-leverage follow-up — "ship change."** Two words unlocked the entire ship pipeline because
  the `ship-change` skill encodes verify → archive → PR → review-loop → merge → cleanup.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at the apply (unit tests only) | "Create e2e test with docker test and playwright with system browser" | Put an e2e task in `tasks.md` up front so the browser proof isn't a separate ask |
| Let the cold Docker build trip the 180s health gate | (self-corrected) boot ONE standalone container, wait on `/api/health`, then attach via `PW_E2E_USE_RUNNING=1` | Prefer the attach-to-running fast path whenever the image build is cold |
| Run the whole e2e suite because the filename filter didn't restrict | (self-corrected) kill + target the exact spec file | Always pass the explicit spec path to `playwright test` |
| Assert on the *expanded* running body while the member step rendered **collapsed** | (self-corrected) expand the collapsed member step first (title = `getSummary` one-liner) | Remember burst members mount the renderer only when expanded — click to expand before asserting |
| Treat 19 verify-gate failures as blockers | (self-corrected) diff changed files vs `origin/develop`, run failing files in isolation, confirm develop CI green | Triage every red test against the base before calling it a regression |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* three existing skills end-to-end:
`openspec-apply-change`, the faux-model e2e pattern, and `ship-change`. That's the reusable asset:
the workflow is already codified. Two techniques are worth capturing as a project note if they
aren't already documented:

- **WS-frame-drop freeze for running-state e2e.** Dropping `tool_execution_end` (and 404-ing the
  reconcile route) in `routeWebSocket` freezes a single-member burst in `running` — the only way to
  deterministically assert a transient UI state. Reuse the `superseded-heal.spec.ts` pattern.
- **Attach-to-running Docker fast path.** `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=… PW_GATEWAY_PORT=…
  PW_CHANNEL=chrome` against a pre-booted container sidesteps the cold-build health-timeout race in
  `docker/test-up.sh`. Invoke it whenever the image needs a fresh build.

## 7. Pitfalls & dead ends

- **Cold Docker build > 180s health gate** → the harness reports "container didn't boot." Fix: boot
  a standalone container, poll `/api/health` yourself, then attach.
- **Playwright filename filter ran the whole suite** → kill the run and pass the exact spec path.
- **Asserted on a collapsed member step** → the `CtxToolRenderer` mounts only when the burst member
  is expanded; click the step (title is the `getSummary` one-liner) before asserting the running body.
- **`openspec archive` rejected the delta** → "Raw fallback still renders a card" was a *Scenario*
  inside `CtxToolRenderer` in the target spec but the delta promoted it to a top-level MODIFIED
  Requirement. Move it under `## ADDED` (nothing to modify), then archive succeeds.
- **`git commit` with backticks in the message** → use `git commit -F <file>` to avoid shell
  backtick substitution.
- **`gh pr merge` tried to check out `develop` locally** (held by the parent worktree) → the remote
  merge still succeeds; delete the remote branch, remove the worktree, and `-D` the local branch
  (squash yields a new SHA so `-d` sees it "unmerged").
- **Shell can't spawn after `git worktree remove`** because its cwd vanished → recreate the directory
  (Write auto-creates parents) or operate from the parent checkout.

## 8. Reproduce it faster — checklist

- [ ] Change artifacts (`proposal.md`, `design.md`, `tasks.md`) complete before `/skill:openspec-apply-change <name>`.
- [ ] Implement production edits + tests in one pass; run scoped vitest to green; `openspec validate`.
- [ ] Add a chip-≠-subtitle regression guard for any header-chip/args change.
- [ ] For a running-state e2e: add a faux scenario, freeze via WS frame-drop, PATCH `generic:true`, expand the member step, assert args chip + `RunningPreview`.
- [ ] Boot one Docker container on an explicit port; wait on `/api/health`; attach with `PW_E2E_USE_RUNNING=1 … PW_CHANNEL=chrome` and the exact spec path.
- [ ] `ship change`: verify → triage reds vs base → `openspec archive` → commit `-F` → PR vs `develop` → CI + real CodeRabbit review → squash-merge → teardown worktree.
- **Key inputs:** running Docker, system Chrome, `origin/develop` for base comparison.
- **Final artifacts:** `packages/client/src/components/tool-renderers/CtxToolRenderer.tsx` (+ test),
  `tests/e2e/ctx-running-render.spec.ts`, `qa/fixtures/faux-scenarios.ts` scenario, archived
  `openspec/changes/archive/2026-07-12-fix-ctx-running-render/`, merged PR #288 (SHA `dfbd5b8`).

---

_Generated from session `019f5855` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: deterministic facts sheet._
