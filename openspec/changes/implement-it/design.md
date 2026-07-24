## Context

`plan-proposal` (develop, human present) intentionally STOPS at the git-worktree
boundary, reporting *"worktree ready. Next: run `ship-it` inside it."* Crossing
that boundary today is a manual human step: create the worktree, spawn a pi
session in it, type the trigger. Both `ship-it` and `openspec-apply-change` are
already headless-runnable, so the only missing piece is a dispatcher that
scripts the crossing.

Research established the exact primitives:
- `POST /api/git/worktree` (REST) creates a worktree (`git worktree add`) and
  returns `{ path, branch }`. It does **not** spawn a session. It is the path the
  dashboard's own `WorktreeSpawnDialog` uses (`SKILL.md`-verified: *"On submit:
  POST /api/git/worktree, then auto-spawn a pi session"*). There is **no**
  `worktree_create` bus verb — git mutations stay on REST by design.
- `bus.spawn({ cwd, gitWorktreeBase?, attachProposal?, initialPrompt? })` (typed
  WebSocket bus client) spawns the session. `gitWorktreeBase` is **metadata only**
  (`event-wiring.ts:326` stamps `.meta.json#gitWorktreeBase`); it does not create
  anything. `initialPrompt` becomes the child session's first user message.
- Skills auto-load in the child by NL trigger, so `initialPrompt` alone steers
  the child to run `ship-it` / `openspec-apply` — no special API needed.

## Goals / Non-Goals

**Goals:**
- Automate the plan→implement boundary crossing from any orchestrator session.
- Mirror the dashboard UI's exact two-call handshake (REST create → bus spawn)
  so behavior matches "start work" — including `gitWorktreeBase` meta parity.
- Steer the child purely via a free-form `initialPrompt` gathered by `ask_user`.
- Compose existing endpoints/skills; add **zero** server or protocol surface.

**Non-Goals:**
- No new server route, bus verb, protocol message, or custom bridge tool.
- No planning logic — `implement-it` dispatches implementation; `plan-proposal`
  still owns planning on develop.
- No child-side re-implementation of `ship-it`/`openspec-apply` — those run in
  the child unchanged.
- No multi-session fan-out / flow orchestration (single child session only).

## Decisions

- **Package as a project skill**, not a slash command / custom tool / flow.
  Rationale: it is a reusable *procedure with judgment* (resolve change, gather
  hints, pick monitor mode, handle 409) that must `ask_user` and auto-load by
  NL — the skill shape fits; a bash slash command cannot `ask_user`, a custom
  tool adds a build/reload surface for no new capability, a flow is the wrong
  shape for one child session. A thin `/dispatch <change>` slash alias MAY be
  added later on top of the skill.
- **Two-call handshake, REST then bus.** `POST /api/git/worktree` for creation
  (only path), then typed `bus.spawn` for the session. Prefer the typed bus
  client over raw curl for the spawn so `gitWorktreeBase` + exact-correlated
  spawn-id resolution come for free.
- **Worktree convention:** `path = .worktrees/os-<change>`, `newBranch =
  os/<change>`, `base = origin/develop` (default). This is the convention
  `ship-it` derives its change name from (worktree dir basename), so the child
  self-orients with no extra wiring.
- **Free-form prompt is the only steering channel.** The gate collects arbitrary
  text; the user embeds their own trigger (`/ship-it`, `/opsx-apply`, or a NL
  instruction) plus hints. This keeps the dispatcher child-skill-agnostic.
- **`ask_user` batch up front** for prompt · base ref · monitor mode; the skill
  makes no mutating call before the gate resolves.
- **Monitor mode chosen at run time** (fire-and-forget vs. wait-until-idle +
  report), per the earlier decision to offer both.

## Risks / Trade-offs

- **Headless child failure visibility.** A fire-and-forget child that fails is
  invisible until inspected. Mitigation: wait-until-idle mode reports final
  status + session diff; the dashboard card also surfaces the child regardless.
- **409 worktree/branch collision.** A prior partial run can leave a branch or
  orphan path. Mitigation: detect `409`, reuse the existing worktree or call
  `orphan-cleanup`; never silently proceed.
- **Prompt-injection of the wrong trigger.** A malformed free-form prompt could
  fail to auto-load the intended skill in the child. Accepted: the child is a
  normal pi session; the user owns the prompt, and monitor mode reveals a no-op.
- **Coupling to the worktree naming convention.** If `ship-it`'s basename→change
  derivation changes, the convention must move in lockstep. Low risk; single
  documented convention shared by both skills.
- **Auth-enabled dashboards.** Remote/tunnel mode needs the JWT cookie for REST;
  the bus client mints its own ticket. The skill targets localhost by default
  (the orchestrator runs beside the server), so this is out of the common path.
