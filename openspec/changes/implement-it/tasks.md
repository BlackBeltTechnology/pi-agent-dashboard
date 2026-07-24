## 1. Skill scaffold

- [ ] 1.1 Create `.pi/skills/implement-it/SKILL.md` with frontmatter (name `implement-it`, project scope, NL triggers: "implement it", "dispatch this change", "auto-ship <change>", "run implementation in a worktree")
- [ ] 1.2 Document preconditions in the skill: dashboard server running (probe `GET /api/health`), `openspec` CLI available, orchestrator/main session (needs `ask_user`)

## 2. Change resolution + gate

- [ ] 2.1 Resolve target change from argument → conversation → `openspec list --json`; `ask_user` to disambiguate when ambiguous (spec: change resolution)
- [ ] 2.2 `ask_user` batch collecting free-form prompt, base ref (default `origin/develop`), and monitor mode BEFORE any mutating call (spec: pre-dispatch gate)

## 3. Worktree creation (REST)

- [ ] 3.1 Derive port/base URL (config.json / `DASHBOARD_PORT` / 8000) and issue `POST /api/git/worktree` with `{cwd, base, newBranch: os/<change>, path: .worktrees/os-<change>}`; use returned `path` as spawn cwd (spec: worktree creation)
- [ ] 3.2 Handle `409 branch_exists`/`path_exists`: reuse existing worktree or call `POST /api/git/worktree/orphan-cleanup`; never silently proceed (spec: worktree/branch already exists)
- [ ] 3.3 Handle non-recoverable errors (`400 base_not_found`/`not_a_repo`): surface and STOP without spawning (spec: worktree creation rejected)

## 4. Session spawn (bus)

- [ ] 4.1 Spawn via `dashboard-bus.ts spawn <path> --prompt "<free-form>" --attach <change>` (or `bus.spawn` with `gitWorktreeBase` = base ref) so meta parity matches the UI (spec: session spawn via typed bus client)
- [ ] 4.2 On bus spawn failure, surface the message and do NOT report success (spec: spawn failure surfaced)

## 5. Monitor mode

- [ ] 5.1 Fire-and-forget: report spawned session id and return immediately (spec: fire-and-forget)
- [ ] 5.2 Wait-until-idle: `until <id> idle`, then report final status + session diff (spec: wait until idle then report)

## 6. Docs + verification

- [ ] 6.1 Add the `implement-it` row to `.pi/skills/AGENTS.md` (nearest tree file) per the Documentation Update Protocol
- [ ] 6.2 Manual end-to-end dry run: dispatch a throwaway change, confirm worktree created at `.worktrees/os-<change>` on `os/<change>`, child session appears with the change attached, and `initialPrompt` triggered the intended child skill
- [ ] 6.3 Verify 409 path: re-run against the same change name and confirm reuse/orphan-cleanup (no silent success), then clean up the throwaway worktree
