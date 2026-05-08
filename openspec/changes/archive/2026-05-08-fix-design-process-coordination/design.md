## Context

The design review process (sandbox → screenshots → designer → review → fixes → repeat) was originally described as a linear 7-step procedure in `openspec-apply-change/SKILL.md`. In practice this fails for three reasons:

1. **Agent blocked during subagent**: `subagent({ async: false })` blocks the agent's turn, preventing intercom communication with the user.
2. **No state across turns**: When the agent finishes a turn, it loses context. On the next turn it has no way to know which phase it was in.
3. **User passive until end**: Screenshots and review results are only shown to the user at the very end of the loop.

Additionally, two skill files contain contradictory instructions about where AFTER screenshots come from (sandbox vs local agent-browser), and `capture-screenshots.sh` omits `--build` on `docker compose up`, causing stale code in containers.

## Goals / Non-Goals

**Goals:**
- Restructure the design process as a state machine with explicit phases, persisted in a checkpoint file
- Use async subagents exclusively — agent turns are triggered by intercom, not by polling
- User receives intermediate screenshots and designer findings at every review round
- Eliminate contradictions between `openspec-apply-change/SKILL.md` and `sandbox-designer/SKILL.md`
- Fix `capture-screenshots.sh` to always rebuild the Docker image

**Non-Goals:**
- Changing the sandbox architecture (still Docker-based, still builds from worktree)
- Changing the sandbox-designer subagent's core review logic (only its communication layer)
- Adding a separate user-facing skill ("overseer") — user interaction is via intercom in their existing session
- Real-time streaming of screenshots (intercom is message-based, turn-triggered)

## Decisions

### Decision 1: Checkpoint file at `~/.pi/dashboard/design-review-state.json`

**Choice**: Single JSON file on disk, read at turn start, written at turn end.

**Alternatives considered:**
- *In-memory state*: Lost when agent turn ends. Rejected.
- *Intercom message metadata*: Requires parsing message history, fragile. Rejected.
- *Environment variables*: Not persisted across turns. Rejected.
- *SQLite*: Overkill for a handful of fields. Rejected.

**Rationale**: JSON file is simple, human-debuggable, survives agent turn boundaries. Written atomically (write to temp + rename).

**Structure:**
```json
{
  "phase": "awaiting-review",
  "designerRunId": "abc123",
  "changeDir": "openspec/changes/session-card-redesign",
  "reviewRound": 2,
  "currentTask": 3,
  "tasksCompleted": [1, 2]
}
```

### Decision 2: Async-only subagent with intercom turn triggers

**Choice**: `subagent({ async: true })` always. Agent turn ends after launching designer. Next turn triggered by intercom.

**Alternatives considered:**
- *Sync subagent + sleep polling*: Agent burns tokens in sleep loops, blocks intercom. Rejected.
- *Sync subagent + manual resume*: User must manually type `/opsx-apply` to continue — no automatic trigger. Rejected.

**Rationale**: `pi-subagents` already emits `emitForegroundResultIntercom` when an async subagent completes. This intercom message triggers a new agent turn automatically. The agent reads the checkpoint, sees its phase, and continues. No polling, no wasted tokens.

**Known limitation**: `INTERCOM_DETACH_REQUEST_EVENT` is defined but never emitted in the current `pi-subagents` code. This means `contact_supervisor` calls from sync subagents cause a 10-minute timeout. Using `async: true` avoids this because async subagents don't need detach.

### Decision 3: Designer uses `contact_supervisor`, not raw `intercom`

**Choice**: Sandbox-designer calls `contact_supervisor({ reason: "progress_update" | "need_decision", message: "..." })`.

**Alternatives considered:**
- *Raw `intercom({ action: "ask", to: "supervisor-name" })*: Requires designer to know supervisor's session name — fragile. Rejected.
- *File-based communication (write findings to file)*: No automatic turn trigger, requires polling. Rejected.

**Rationale**: `contact_supervisor` is the `pi-subagents` escalation API. It already handles routing, message formatting, and the reply channel. The designer doesn't need to know the supervisor's session name.

### Decision 4: Message format convention with runId header

**Choice**: All `contact_supervisor` messages from designer start with `[designer:<runId>]` header.

**Rationale**: When the supervisor gets an intercom-triggered turn, it needs to know which designer subagent sent the message (in case multiple are running). The runId is already in the checkpoint file, so the supervisor can cross-reference.

### Decision 5: Fix capture-screenshots.sh with `--build`

**Choice**: Replace `docker compose up -d --wait` with `docker compose up -d --build --wait`.

**Rationale**: Without `--build`, Docker reuses the last-built image, which may contain stale code. The `--build` flag forces a rebuild, ensuring the `COPY . /app` layer and `RUN npm run build` layer reflect the current worktree. Tradeoff: adds 30-90 seconds per capture round.

### Decision 6: Skill instructions use declarative rules, not narrative

**Choice**: Each skill section describing intercom coordination uses short, imperative rules ("SHALL", "MUST", "NEVER").

**Rationale**: The agent reading the skill needs actionable, unambiguous instructions. Narrative descriptions ("you might want to...") lead to the agent guessing.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Checkpoint file corruption or stale state | Atomic write (temp + rename). Agent validates phase on read; if unknown phase, starts from `init`. |
| `--build` adds 30-90s per review round | Documented tradeoff in skill. Acceptable because correctness > speed. Future: explore bind-mount alternative. |
| Intercom message delivery failure | Agent checks `result.delivered`. If failed, retries once. If still failed, writes error to checkpoint and pauses. |
| User doesn't respond to intercom | Agent writes "awaiting_user_response" to checkpoint. When user eventually responds (new turn via intercom), agent resumes. No timeout — user controls pace. |
| Multiple concurrent design processes | Checkpoint file is single-instance per machine. Only one design process at a time. Future: per-change checkpoint. |
| `contact_supervisor` API may change | All designer logic is in `sandbox-designer/SKILL.md` which we control. Adaptable. |
| Designer subagent may not have `contact_supervisor` tool | We ensure the sandbox-designer agent definition includes the tool. Verification step in tasks. |

## Migration Plan

1. **Skills updated first**: `openspec-apply-change/SKILL.md` and `sandbox-designer/SKILL.md` rewritten with new coordination instructions.
2. **capture-screenshots.sh patched**: Add `--build` flag.
3. **Old checkpoint files**: No migration needed — the checkpoint is per-process and ephemeral (deleted on completion).
4. **Rollback**: If the new process fails, revert skill files to previous versions. No code changes, only documentation/skill updates.

## Open Questions

- Should the checkpoint file be per-change (e.g., `<change-dir>/.checkpoint.json`) instead of global? Leaning yes for future but global is simpler for V1.
- Should the user have their own skill ("design-overseer") that describes how to receive and respond to intercom messages? Deferred — for now, intercom messages include self-documenting reply instructions.
