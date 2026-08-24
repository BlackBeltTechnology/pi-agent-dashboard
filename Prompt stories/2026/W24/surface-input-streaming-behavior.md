---
session: 019ec6c6
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [surface-input-streaming-behavior]
proposal_excerpt: "Pi 0.77 added an optional `streamingBehavior?: \"steer\" | \"followUp\"` field to `InputEvent`:"
---

# How we did it: Surface mid-stream input streaming behavior as an inline badge — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was terse: _"Validate the proposal state, lot of changes was mode on codebase."_
The real objective, clarified across the steering turns, was a full **plan→build→ship**
of the OpenSpec change `surface-input-streaming-behavior`: re-verify that the stub
proposal's premise still held against a codebase that had drifted (pi bumped to 0.78),
implement the feature (render pi's `InputEvent.streamingBehavior` in the dashboard UI),
apply the OpenSpec change, archive it, then commit → PR → CI-green → merge → clean up the
worktree. It ran end-to-end in one 50-minute session on `anthropic/claude-opus-4-8`.

## 2. TL;DR playbook

1. **Validate the proposal against live code first.** Ask the AI to re-check every line-number
   and architecture claim in `proposal.md` — stub proposals rot when the codebase moves.
2. Run `/skill:openspec-apply-change <change>` to load the task schema and progress.
3. **Stop at the design gate.** Tasks 0.1–0.3 were a genuine fork (Option A card vs Option B
   inline badge; all-sources vs interactive-only). The AI used `ask_user` — answer it, don't
   let it guess.
4. Implement Option B: reducer correlation slot + `input` case + stamp on `message_start`,
   then the `StreamingBehaviorBadge` UI in `ChatView.tsx`.
5. Write tests first-class: 7 reducer scenarios + 3 render cases. Run under `HOME=$(mktemp -d)`
   to dodge machine config, and `git stash` to prove pre-existing failures are not yours.
6. `archive` the change — expect the archive to surface **pre-existing canonical-spec defects**
   you must fix to complete the merge.
7. `commit` (exclude machine-local `.pi/settings.json`), push, `gh pr create --base develop`,
   `gh run watch` to green.
8. `gh pr merge --squash --delete-branch`, then `cd` OUT of the worktree before `git worktree remove`.

## 3. How the collaboration unfolded

**Phase 1 — Validate the premise (Discovery).** The AI treated the stub proposal as a hypothesis,
not gospel. It checked that the blocker `bump-pi-compat-to-0-78` was archived, that pi 0.78 was
actually installed (hoisted to the main-repo `node_modules`, not the worktree's), that
`streamingBehavior` existed in `types.d.ts`, that `input` was in the bridge `passThroughEventTypes`,
and that the reducer had no `input` handler (so it rendered as a rawEvent JSON card). Every claim
got a ✅/status table. **Why it worked:** turning each proposal assertion into a verifiable grep
caught the drift and confirmed the blocker was already resolved.

**Phase 2 — Design gate (decision point).** Applying the change revealed tasks 0.1–0.3 as a design
gate. The drafted tasks leaned Option A (rawEvent-style card, all sources); the AI paused and used
`ask_user`. **The human chose Option B (inline badge) + interactive-only** — a deviation, so the AI
re-scoped `tasks.md`/`design.md` to the correlation approach before writing code.

**Phase 3 — Implement (Generate).** Reducer: added `ChatMessage.streamingBehavior`, a
`SessionState.pendingInputBehavior` correlation slot, a new `case "input"` (interactive + mid-stream
stores behavior; idle/rpc/extension no-op), and consumed the slot in the user `message_start` branch.
UI: a `StreamingBehaviorBadge` pill (**steered** / **queued**) above the user bubble, on both plain
and skill-card paths.

**Phase 4 — Verify.** 158 reducer tests (7 new) + 3 badge tests green. The full suite showed 21
failures — the AI `git stash`ed and re-ran to prove they were pre-existing (jimp native dep, timing
flakes), not regressions. CI later confirmed: `npm test` green in CI.

**Phase 5 — Archive & ship.** `archive` aborted three times, each on a pre-existing canonical-spec
defect (see §7). After fixing them the change archived, then commit → PR #122 → CI green → squash-merge
→ worktree removed.

## 4. Prompts that worked

- **Goal prompt** — _"Validate the proposal state, lot of changes was mode on codebase."_ Effective
  because it framed the task as **validation-first**: it told the AI the code had moved, so it
  re-checked the premise before trusting the proposal. A stronger version: _"Re-verify every
  line-number and architecture claim in the proposal against current code, then report what still holds."_
- **`/skill:openspec-apply-change surface-input-streaming-behavior`** — loaded the task schema and
  progress deterministically instead of improvising.
- **High-leverage one-worders:** `go on`, `archive`, `commit, create PR and monitor CI`,
  `merge PR, delete branch and remove worktree`. Each unlocked a whole phase because the workflow
  (apply → archive → ship) was already well-scoped, so a single verb advanced it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Draft toward Option A (rawEvent card, all sources) per the stale tasks.md | Choosing **Option B (inline badge) + interactive-only** at the gate | State the UI shape + source scope in the proposal's decision section up front |
| Treat the full-suite 21 failures as ambiguous | Implicitly demanding proof they were pre-existing | AI self-corrected: `git stash` + baseline re-run to isolate blame |
| Try to remove the worktree while `cd`'d inside it | (self-corrected) `cd` out first | Always `cd <main-repo>` before `git worktree remove` |
| Stage the machine-local `.pi/settings.json` | (self-corrected) exclude it — worktree-local path config | `git checkout -- .pi/settings.json` before staging |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a clean run of existing ones
(`openspec-apply-change`, the archive/ship flow). **What should be captured:** the recurring
lesson that **`openspec archive` surfaces latent canonical-spec defects** (duplicate `## Requirements`
headers, scenario-less requirements, wrong `MODIFIED` vs `ADDED` delta labels). A short skill —
_"fix canonical-spec defects that block archive"_ — would remove the same 20-minute detour next time.

## 7. Pitfalls & dead ends

- **`openspec archive` blocked 3× by pre-existing spec defects.** (1) A stray duplicate
  `## Requirements` header at line 107 hid 8 requirements from the parser — remove it. (2) A
  `Session state structure` requirement had no scenario (previously masked by defect 1) — add a
  minimal one backed by an existing test. (3) The change's delta was labeled `## MODIFIED Requirements`
  for a genuinely new requirement — change to `## ADDED Requirements`.
- **Local `npm test` shows 21 failures that CI does not.** They're environmental (jimp native dep,
  timing flakes in server e2e). Prove it with `git stash` + baseline re-run; don't chase them.
- **`HOME` leakage into vitest.** Run tests as `HOME=$(mktemp -d) npx vitest run …` to avoid picking
  up machine config.
- **`gh pr create` with a nested heredoc body** fails on quoting — write the body to a file and use
  `--body-file`.
- **`git worktree remove` from inside the worktree** breaks the shell's CWD — `cd` to the main repo first.

## 8. Reproduce it faster — checklist

- [ ] Re-validate the proposal's line-number/architecture claims against current code (grep each).
- [ ] Confirm the pi version premise: is the required field in the *installed* `node_modules` (check the hoisted main-repo copy)?
- [ ] `/skill:openspec-apply-change <change>` → answer the design gate via `ask_user`, don't guess.
- [ ] Implement; write reducer + render tests first. Run with `HOME=$(mktemp -d)`; `git stash` to isolate pre-existing failures.
- [ ] `archive` → be ready to fix duplicate `## Requirements`, missing scenarios, `MODIFIED`→`ADDED` deltas.
- [ ] Commit (drop `.pi/settings.json`), push, `gh pr create --base develop`, `gh run watch` to green.
- [ ] `gh pr merge --squash --delete-branch`; `cd` to main repo; `git worktree remove`.

**Inputs to have ready:** the OpenSpec change name, `gh` auth, pi 0.78 installed.
**Artifacts produced:** `event-reducer.ts` + `ChatView.tsx` (badge), reducer/badge tests,
archived change `2026-06-14-surface-input-streaming-behavior`, CHANGELOG entry, merged PR #122.

---

_Generated from session `019ec6c6` · `pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-GlVxrF.md`._
