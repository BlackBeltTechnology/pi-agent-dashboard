---
session: 019f5480
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [gate-session-worktree-button-on-git]
proposal_excerpt: "The session-card `+Worktree` button is offered in folders that are not git repositories, where `git worktree add` cannot succeed. The obvious one-line fix — gate on `session.gitBranch` — is **unsound** (rejected in do…"
---

# How we did it: Gate the `+Worktree` button on real git state — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change gate-session-worktree-button-on-git
```

The real objective, once the attached OpenSpec change is read: the session-card
`+Worktree` button was being offered in folders that are **not** git repositories,
where `git worktree add` can never succeed. The naive fix — gate the button on
`session.gitBranch` — was explicitly rejected in the design as **unsound** (a repo
can exist with no branch info yet, and arrival-order races make `gitBranch` an
unreliable proxy). The mandate: thread a **persistent, arrival-independent tri-state
`isGitRepo` signal** (`true | false | undefined`) end-to-end — bridge detection →
protocol → server persistence → client gate — and hide the button **only on
confirmed non-git** (`=== false`), never on unknown. Then a second prompt,
`ship-change`, drove the whole thing to a merged PR.

## 2. TL;DR playbook

1. **Attach the change, then run `/skill:openspec-apply-change <name>`.** Let the skill read all context files and enumerate tasks (here: 16 tasks, spec-driven schema).
2. **Implement in dependency order, layer by layer:** shared types/protocol → bridge detection → server persistence → client gate → docs. Each layer's test runs before moving on.
3. **Model the signal as a tri-state, not a boolean.** `detectIsGitRepo(cwd): boolean | undefined` — `git.isGitRepo()` ok→value, exit-128→`false`, any other failure→`undefined`. Never emit a false negative.
4. **Attach the signal at every register site.** Grep found *three* `session_register` sends (`session-sync.ts` ×2, `bridge.ts` ×1) plus a `git_info_update` refresh in `model-tracker.ts`. Register is the authority — no arrival race.
5. **Gate the UI on `!== false`, not on truthiness.** `session.isGitRepo !== false` on both the card button and the folder-header `FolderSpawnButtons`.
6. **Run tests per-package with an isolated HOME** (`HOME=$(mktemp -d) npx vitest run …`) and bump server-boot tests to `15000ms` (cold jiti import is slow).
7. **Prove pre-existing failures are not yours:** `git stash` → run the failing tests on clean `develop` → restore. Only proceed if the failures reproduce without your change.
8. **For the manual smoke, isolate — never touch live bridges.** Run the worktree server on alt ports (8100/9100) with `PI_CODING_AGENT_SESSION_DIR` pointed at a temp dir, drive it with raw WS as a fake bridge+browser, verify persist→broadcast→restart→restore.
9. **Ship with `ship-change`:** verify gate → archive+sync specs → commit → PR → watch CI → wait for CodeRabbit → resolve conflicts → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply the change (Discovery + Implement).** The skill loaded the change,
read every context file, and reported `0/16 tasks`. The AI then walked the tasks in
strict dependency order. It did **not** guess at file structure — before each edit it
`grep`ped for the exact symbols (`session_register`, `gitWorktree`, `isGitRepo`,
`mergeSessionMeta`) to locate the real call sites. This is why the change landed
cleanly across 17 files: every edit targeted a confirmed location.

**Phase 2 — Thread the signal (the core design).** Shared first (`protocol.ts`,
`types.ts`, `session-meta.ts`) so the type existed before any producer/consumer. Then
the bridge: a new `detectIsGitRepo` reading `git.isGitRepo()`'s `Result` shape, with
the deliberate exit-128→`false` / else→`undefined` split so a transient git failure
never hides the button on a real repo. The decision point that mattered: the AI
discovered **three** register sites via grep and wired all three, rather than
assuming one.

**Phase 3 — Server persist + client gate.** `event-wiring.ts` persists on register
and refreshes on `git_info_update`; `sessionFromMeta` restores it on cold start. The
client gate used `!== false` (tri-state aware) on both button locations, backed by 6
new gate tests covering card + folder-header × {false, true, undefined}.

**Phase 4 — Verify without disrupting production.** The highest-leverage judgment of
the session: the AI recognized the running server (pid 53727, 10 live bridges) was
launched from the **main repo**, so a rebuild+restart+reload from the worktree would
exercise **none** of its code and churn 10 live bridges for zero value. Instead it ran
an isolated two-part smoke (real-git `detectIsGitRepo` + alt-port live server with an
isolated session dir), proving the full persist→restore path without touching
production.

**Phase 5 — Ship.** `ship-change` ran the verify gate, archived the change (repairing
a *pre-existing* structural defect in the `git-context` main spec that was blocking
archive), opened PR #279, waited out a CodeRabbit rate limit (~34 min), got a clean
full review, resolved two AGENTS.md merge conflicts by union/graft, and squash-merged.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change gate-session-worktree-button-on-git`.**
  Effective because the change was already fully specced (proposal + design + 16-task
  tasks.md). The skill invocation loads all context and gives the AI a checklist to
  execute — no ambiguity to negotiate. *The upstream investment in a sound design
  (rejecting the naive `gitBranch` gate) is what made this one-liner sufficient.*
- **The ship prompt — `ship-change`.** A single word that triggered the entire
  land-the-change pipeline. High-leverage because the skill encodes every gate
  (verify → archive → PR → CI → review → merge → cleanup); the human never had to
  micro-manage the release.

Both prompts are strong as-is precisely because the heavy lifting was pre-encoded in
skills + a rigorous OpenSpec change. The reproducible lesson: **spec soundly first,
then the apply/ship prompts are trivial.**

## 5. Steering & corrections (what to watch for)

Only two user prompts — the human trusted the AI to self-correct. The "steering" here
is the AI's own guardrails, which a future operator should bake in up front:

| The AI tended to… | The correct move it made (bake this in) | How to bake it in next time |
|-------------------|------------------------------------------|-----------------------------|
| Assume one `session_register` site | grep found **three** + a refresh path | Always grep every producer of a message before wiring a new field |
| Reach for rebuild+restart+reload to smoke-test | Detected the live server runs from **main repo**, not the worktree → refused | Check `lsof -a -p <pid> -d cwd` before any restart in a worktree |
| Let a temp server clobber real `~/.pi/dashboard/config.json` | Verified `ensureConfig` no-ops + `createServer` takes ports as args | Isolate with `PI_CODING_AGENT_SESSION_DIR=$(mktemp -d)` + alt ports |
| Treat 17 test failures as a regression | `git stash` → prove they fail on clean `develop` → restore | Never block on failures you haven't proven are yours |
| Archive straight away | Hit a pre-existing corrupt `git-context` main spec (stray `## ADDED Requirements`, missing `## Purpose`) blocking archive | Expect archive to surface latent spec defects; fix surgically |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session was a *consumer* of existing
ones, which is the point. The workhorses:

- **`openspec-apply-change`** — turns a specced change into an ordered, testable
  implementation. Effective because it enforces read-all-context → task-by-task →
  test-per-layer, preventing the AI from free-styling.
- **`ship-change`** — encodes the entire land pipeline (verify/archive/PR/CI/review/
  merge/cleanup) including the pitfalls (CodeRabbit rate-limit is warn-and-continue;
  squash-merge leaves the local branch "unmerged"; worktree collision on
  `--delete-branch`). Invoke it whenever an applied change is ready to land.

Reusable pattern worth a skill if not already captured: **"isolated worktree smoke
test"** — alt-port server + `PI_CODING_AGENT_SESSION_DIR` temp dir + raw-WS fake
bridge/browser to verify persist→restart→restore without touching live bridges.

## 7. Pitfalls & dead ends

- **Rebuild/restart from a worktree exercises nothing** if the live server was
  launched from the main repo. Check `lsof -a -p <pid> -d cwd` first; the worktree's
  `npm run build` writes to a `dist/` the running server never serves.
- **Cold server-boot tests are slow** (first jiti import). The default 5000ms times
  out — bump server-boot tests to `15000ms`. Two develop tests (`doctor-route`,
  `recovery-offer`) were *pre-existing* cold-boot flakes; proven via stash.
- **`image-fit` package fails with `Jimp is not a constructor`** — a pre-existing
  dependency issue, untouched by this change. Don't chase it.
- **`openspec archive` aborts on corrupt main specs.** The `git-context` main spec had
  a leftover `## ADDED Requirements` delta header + no `## Purpose`. Fix = rename to
  `## Requirements` and add a `## Purpose`, matching a healthy sibling spec.
- **Squash-merge + worktree cleanup order matters.** `gh pr merge --delete-branch`
  fails its local `develop` checkout on a worktree collision; the remote merge still
  succeeds. Verify via `gh pr view`, then delete remote branch, remove worktree,
  force-delete (`-D`) the local branch (squash means git doesn't see it as merged),
  and re-anchor your shell out of the now-deleted worktree dir.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (fully specced), a clean worktree,
`gh` authenticated, awareness of which repo the live dashboard server runs from.

- [ ] `/skill:openspec-apply-change <change-name>` — read context, enumerate tasks.
- [ ] Implement shared → bridge → server → client → docs, in that order.
- [ ] Model the signal as a tri-state; grep every producer before wiring the field.
- [ ] Gate the UI on `!== false`, not truthiness.
- [ ] `HOME=$(mktemp -d) npx vitest run <files>`; bump server-boot tests to 15000ms.
- [ ] Prove any failures are pre-existing: `git stash` → test on `develop` → restore.
- [ ] Isolated smoke: alt-port server + `PI_CODING_AGENT_SESSION_DIR=$(mktemp -d)` + raw-WS driver. Never touch live bridges.
- [ ] `ship-change` — verify → archive (fix latent spec defects) → PR → CI → CodeRabbit → resolve conflicts → squash-merge → remove worktree.

**Artifacts produced:** 17 code files across `packages/{shared,extension,server,client}`
+ AGENTS.md tree rows + `openspec/specs/git-context/spec.md` repair; PR #279 merged
(squash `6fb77e6`) into `develop`.

---

_Generated from session `019f5480` · `pi-agent-dashboard` · 2026-07-12. Source extract: session facts sheet (extract_session.ts)._
