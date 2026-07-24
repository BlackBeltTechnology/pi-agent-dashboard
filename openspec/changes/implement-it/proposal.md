## Why

Crossing the plan→implement boundary is manual: after `plan-proposal` stops at
the worktree checkpoint, a human must create the worktree, spawn a pi session in
it, and type the trigger to run `ship-it`/`openspec-apply`. This is the one
hand-step in an otherwise headless-capable pipeline. A dispatcher skill run from
any orchestrator session can automate it by mirroring the dashboard's own
"start work" handshake — with an `ask_user` gate for free-form instructions to
the child LLM.

## What Changes

- Add a **project skill `implement-it`** (`.pi/skills/implement-it/`) that runs
  in the orchestrator/main session and dispatches a change's implementation to a
  fresh worktree + spawned pi session.
- The skill performs the **same two-call handshake the dashboard UI performs**
  (`WorktreeSpawnDialog`): `POST /api/git/worktree` (REST — the only creation
  path; no WebSocket twin exists) to create `.worktrees/os-<change>` on branch
  `os/<change>`, then `bus.spawn({ cwd, gitWorktreeBase, attachProposal,
  initialPrompt })` (typed bus client) to launch the session.
- The child LLM is steered purely through **`initialPrompt`** (free-form text
  gathered via `ask_user`) — skills auto-load by NL trigger, so a prompt like
  `"/ship-it\nHints: …"` makes the child run the target skill. No new command
  verb or server surface.
- An **`ask_user` batch** up front collects: the free-form prompt/instructions,
  the base ref (default `origin/develop`), and the post-spawn monitor mode
  (fire-and-forget vs. wait-until-idle-then-report).
- Handle the worktree-already-exists case (`409 branch_exists`/`path_exists`):
  reuse the existing worktree or invoke `orphan-cleanup`, never silently fail.

## Capabilities

### New Capabilities
- `implement-it`: an orchestrator-side dispatcher skill that creates a change's
  git worktree via REST, spawns a pi session in it via the typed bus client, and
  injects free-form user instructions as the session's initial prompt, with an
  `ask_user`-selected monitor mode.

### Modified Capabilities
<!-- None. This is a new skill composing existing REST + bus endpoints; no
     server, protocol, or existing-spec behavior changes. -->

## Impact

- **New file:** `.pi/skills/implement-it/SKILL.md` (+ any small helper script it
  needs under `.pi/skills/implement-it/scripts/`).
- **Consumes, does not change:** `POST /api/git/worktree` (REST create),
  `bus.spawn` / `dashboard-bus.ts` (session spawn with `gitWorktreeBase` +
  `initialPrompt`), and the existing `ship-it` / `openspec-apply-change` skills
  (invoked in the child via `initialPrompt`).
- **Docs:** row in `.pi/skills/AGENTS.md` (or nearest tree file) per the
  Documentation Update Protocol; possible mention in `docs/architecture.md`
  handoff flow (delegated to DocScribe).
- **No breaking changes.** Purely additive; the manual boundary path still works.
