---
session: 019ea14d
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (9 user prompts); large facts sheet (~14225 tok)"
upgrade_status: pending
openspec_changes: [add-ask-user-input-multiline-paste]
proposal_excerpt: "The dashboard's main prompt composer (`CommandInput`) has been multiline-with-image-paste for ages: `<textarea>` + `useImagePaste` + `ImagePreviewStrip`, with images riding to the agent as a mixed content block via `p…"
---

# How we did it: ship `ask_user{method:"input"}` multiline + image-paste — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a five-word hunch: *"Maybe proposal is old and some changes making
drift. Ceck"*. The real objective, once the follow-ups clarified it, was the entire
end-to-end delivery of an OpenSpec change (`add-ask-user-input-multiline-paste`):
**first drift-check the stale proposal against `develop`, rewrite the artifacts to
match reality, then implement, test, verify in a browser, archive, PR, get CI + a
CodeRabbit pass, merge, and tear the worktree down.** The feature itself: make the
dashboard's `ask_user{method:"input"}` renderer a multiline textarea that accepts
pasted images (standalone *and* inside the batch wizard), mirroring the main
`CommandInput` composer.

## 2. TL;DR playbook

1. **Drift-check first.** Before touching code, diff the proposal's "current state"
   claims against `git log`/`git show` on the target files — a later commit (`#76`
   redesign) had re-architected exactly what the proposal assumed.
2. **Rewrite the artifacts to reality, not the reverse.** Update `proposal.md` /
   `design.md` / `tasks.md` / `spec.md` so the batch plan matched the new
   `ctx.ui.batch` wizard, then re-`openspec validate --strict`.
3. **Run `/skill:openspec-apply-change`** and work tasks in order; expect a design
   gap to surface mid-apply.
4. **When a gap needs a human decision, `ask_user` with two concrete options** (here:
   where to wire attachment persistence — tool-side vs bridge-side). Pick, then
   re-sync the artifacts *before* writing code.
5. **Implement bottom-up:** protocol fields → transport plumbing → pure helper module
   → bridge wiring → shared UI component (`InputComposer`) consumed by both renderers.
6. **TDD the contract change.** Enter→newline / Cmd+Enter→submit changes the submit
   contract, so rewrite the renderer tests first; keep the full suite green minus
   pre-existing failures.
7. **Archive → commit → rebase onto develop → PR → monitor CI → wait for CodeRabbit
   → apply its fixes → re-push → squash-merge → remove worktree.**

## 3. How the collaboration unfolded

**Phase 1 — Drift discovery.** The AI read the proposal, then verified every
"current state" claim with targeted `grep`/`git show --stat 4a7eed9c`. It found the
`#76` "redesign question cards + batch wizard" commit had replaced the per-question
`for…of` dispatch loop with a single `ctx.ui.batch(...)` call returning an
index-aligned `BatchAnswer[]`, rendered by a new `BatchRenderer`. **Why it worked:**
it treated the proposal as a *hypothesis to falsify*, not gospel — cheap grep before
any edit.

**Phase 2 — Artifact repair.** Only the batch sections had drifted (standalone-input
plan survived). The AI rewrote proposal/design/tasks/spec to the new architecture:
images ride inside `BatchAnswer.images` for batch, `PromptResponse.images` for
standalone; one bypass site, not two; a shared `<InputComposer>` extracted for both
renderers. Re-validated `--strict`.

**Phase 3 — Apply + the design decision.** Running the apply skill surfaced a genuine
gap the tasks didn't foresee: `registerAskUserTool(pi)` receives *only* `pi` — no
`promptBus`, `sessionId`, or `connection` — yet attachment persistence + `asset_register`
need all three, which only exist in `bridge.ts`. The AI **stopped and `ask_user`'d**
between Option A (thread deps into the tool) and Option B (bridge-side wiring, following
the existing `ctx.ui.batch` precedent). Human chose **B**; artifacts re-synced, then code.

**Phase 4 — Implementation + tests.** Bottom-up: protocol fields, client→bridge
transport, a pure `ask-user-attachments.ts` helper (disk writer, MIME→ext, caps,
cleanup), bridge `persistAnswerImages` + `inputWithImages` patch + `session_end`
cleanup, then `InputComposer` consumed by `InputRenderer` and `BatchRenderer`'s step.
Tests rewritten for the new submit contract; 119 affected tests green, tsc clean for
changed files (the 18 full-suite failures were pre-existing Jimp/timing flakes).

**Phase 5 — Isolated browser verification (partial).** The AI built a fully isolated
dashboard (temp HOME, ports 8899/9988, `PI_DASHBOARD_NO_MDNS=1`, `--no-tunnel`) and
got the worktree UI rendering, but no agent turn ever started (a pre-existing
`ctx.hasUI` pi-version quirk), so live `ask_user` render couldn't be exercised. It
reported this honestly rather than claiming success.

**Phase 6 — Ship.** Archive (fixing a pre-existing stray `## ADDED Requirements`
spec-header defect that blocked it), commit excluding local `.pi/settings.json` drift,
rebase onto develop, PR #91, CI green, CodeRabbit pass with 2 comments (both applied),
squash-merge, worktree removed.

## 4. Prompts that worked

- **Goal prompt** — *"Maybe proposal is old and some changes making drift. Check"*
  was weak-but-effective: it correctly directed effort to **verification before
  implementation**, which caught the `#76` drift. Stronger version:
  *"Drift-check the `<change>` proposal against develop — verify each 'current state'
  claim with git, list what changed, then rewrite the artifacts to match."*
- **`/skill:openspec-apply-change <name>`** — high-leverage: hands the whole
  implement-and-verify loop to the skill.
- **"Test in isolated env (home, ports) with browser plugin"** — unlocked a lot of
  careful harness work; would be stronger with the guardrail baked in (see §5).
- **Terse ship chain** — *"archive"*, *"commit, push, create PR and monitor CI"*,
  *"Is coderabbit review finished?"*, *"merge PR"*, *"delete branch, worktree"* — each
  a single verb that advanced one ship stage. Effective because the earlier phases
  left the change in a known-good, well-documented state.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Trust the proposal's "current state" as fact | "Maybe proposal is old… check" | Always drift-check artifacts vs `git log` on target files before applying |
| Stall on a long-running command | "stuck te last command. go on" | Add explicit timeouts / `tee`→tail so long steps don't look hung |
| Reach for the default `--port` on `pi-dashboard stop` | (recovered after it killed the real dashboard) | Saved a `tool-quirk` memory; never `stop` without the isolated `--port` |
| Advertise the isolated server over machine-wide mDNS (stole a stray bridge) | (self-corrected) | Always launch isolated servers with `PI_DASHBOARD_NO_MDNS=1` + `PI_DASHBOARD_URL` |
| Mark the 5 manual smoke-tasks done though never verified | (self-corrected before archive) | Keep manual/visual tasks unchecked until a human actually paste-tests |

## 6. Skills, tools & memory created — and why they're effective

- **Memory (tool-quirk / failure): pi-dashboard isolated testing on macOS.** Captures
  three hard-won facts: (1) `pi-dashboard stop` without `--port` kills the user's real
  dashboard on 8000/9999; (2) mDNS advertising is machine-wide and will steal stray
  bridges unless `PI_DASHBOARD_NO_MDNS=1`; (3) Unix-socket paths under `/var/folders`
  blow the macOS ~104-char limit, so use a short temp HOME (e.g. `/tmp/pix`).
  **Why effective:** it converts a live-service disruption into a one-line checklist,
  invoked whenever isolated browser verification is set up.
- **Recommended skill to create:** an `isolated-ui-verification` playbook wrapping the
  full safe-harness recipe (short HOME, isolated ports, no-mDNS, no-tunnel, real auth
  via full `~/.pi/agent` copy) — this session rebuilt it from scratch and hit every
  trap. (Such a skill now exists in project memory; prefer it over improvising.)

## 7. Pitfalls & dead ends

- **A recurring stray `tcid` key** kept appearing in edits (5+ retries) — watch for and
  strip accidental tokens the model injects into edit payloads.
- **Isolated HOME vs model auth tension:** attachments hardcode `os.homedir()/.pi/dashboard/…`,
  so a truly isolated HOME also hides OAuth creds — copy the full `~/.pi/agent` (which
  carries `auth.json`) into the temp HOME so the spawned agent can still call an LLM.
- **`/var/folders` socket-path length** crashed the keeper (code 2); recreate the
  isolated HOME at a short path (`/tmp/pix`).
- **Live `ask_user` render is not automatable in isolation** — a pre-existing `ctx.hasUI`
  getter incompatibility (`bridge.ts → hasui-flip.ts:27`) stopped agent turns; and the
  browser tool has no "paste image" primitive. Rely on the green unit tests for the
  paste→disk→`asset_register` path.
- **Archive aborted on a pre-existing stray `## ADDED Requirements` header** mid-spec
  (leftover from `#76`'s archive) — remove it to fold the orphaned requirement back
  under `## Requirements`, then re-archive.
- **`gh pr merge` post-merge branch-switch failed** on untracked `.pi/settings.json`
  drift — the merge still completed on GitHub; ignore the local checkout error.
- **Removing the worktree you're `cd`'d into** breaks the shell's cwd — run
  `git worktree remove` from the main repo, or restart the session afterward.

## 8. Reproduce it faster — checklist

- [ ] Drift-check: `git show --stat <recent-commit> -- <target files>`; verify each
      proposal "current state" claim before editing.
- [ ] Rewrite drifted artifacts; `openspec validate <change> --strict`.
- [ ] `/skill:openspec-apply-change <change>`; work tasks in order.
- [ ] On a design gap, `ask_user` with 2 concrete options; re-sync artifacts before code.
- [ ] Implement bottom-up: protocol → transport → pure helper → bridge → shared UI.
- [ ] TDD any contract change (rewrite renderer tests first); keep suite green.
- [ ] Isolated verify (if needed): short HOME `/tmp/pix`, isolated ports,
      `PI_DASHBOARD_NO_MDNS=1`, `PI_DASHBOARD_URL`, `--no-tunnel`, full `~/.pi/agent` copy.
      **Never `pi-dashboard stop` without the isolated `--port`.**
- [ ] Keep manual/visual smoke tasks unchecked until a human paste-tests.
- [ ] Archive (fix any stray `## ADDED` header) → commit (exclude `.pi/settings.json`)
      → rebase onto develop → PR → CI → apply CodeRabbit fixes → squash-merge.
- [ ] Remove worktree from the main repo, not from inside it.

Key inputs to have ready: an OpenSpec change dir, real pi model auth (`~/.pi/agent`),
`gh` CLI. Final artifacts: PR #91 (squash `9658c9d5c` on `develop`); new
`ask-user-attachments.ts`, `InputComposer.tsx`, `ask-user-attachments.test.ts`; edited
protocol/bridge/renderers; 7 ADDED requirements synced into `ask-user-tool` spec.

---

_Generated from session `019ea14d` · `pi-agent-dashboard` · 2026-06-07. Source extract: `session_facts.LIpvh3`._
