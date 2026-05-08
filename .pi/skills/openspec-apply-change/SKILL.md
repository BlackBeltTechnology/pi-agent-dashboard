---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx-apply <other>`).

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema - could be proposal/specs/design/tasks or spec/tests/implementation/docs)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using openspec-continue-change
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

4. **Read context files**

   Read every file path listed under `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - Mark task complete in the tasks file: `- [ ]` → `- [x]`
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! Ready to archive this change.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names
- **For UI changes with mockup.html**: Follow the Design Process State Machine below. Do NOT use the old linear 7-step procedure.

---

## Design Process State Machine (UI Changes)

When the change includes a `mockup.html`, the implementation process is a **turn-based state machine**.
Each phase that requires external input ends the current turn. The next turn resumes from a checkpoint file.

### Checkpoint File

Location: `~/.pi/dashboard/design-review-state.json`

```json
{
  "phase": "awaiting-review",
  "designerRunId": "abc123",
  "changeDir": "openspec/changes/<name>",
  "reviewRound": 2,
  "currentTask": 3,
  "tasksCompleted": [1, 2]
}
```

**Rules:**
- Read checkpoint at start of UI design phase. If it exists, resume from recorded phase.
- If no checkpoint exists, start from `init`.
- Write checkpoint at every phase transition.
- Delete checkpoint when phase `done` is reached.

### Turn Boundaries

The agent MUST complete its turn (NOT poll or sleep-wait) when transitioning to:
- `awaiting-designer` — waiting for sandbox-designer subagent to complete
- `showing-mockup` — waiting for user approval
- `awaiting-review` — waiting for designer review results
- `showing-review` — waiting for user final approval

Next turns are triggered by intercom messages (designer completion or user reply).

### Phases

#### Phase: `init`
1. Build sandbox: `docker compose -f sandbox/docker-compose.yml up -d --build --wait dashboard`
2. Capture BEFORE screenshots: `sandbox/scripts/capture-screenshots.sh <change-dir>/screenshots/scenario.json <change-dir>/screenshots/`
3. Invoke sandbox-designer:
   ```
   subagent({
     agent: "sandbox-designer",
     async: true,
     task: `Generate mockup.html for <change>.
   Read these screenshots first:
   - <change-dir>/screenshots/session-list-desktop.png
   - <change-dir>/screenshots/session-list-mobile.png
   Read: <change-dir>/proposal.md, <change-dir>/design.md, <change-dir>/specs/<capability>/spec.md
   Required states: <list from proposal>
   CSS constraint: CSS custom properties ONLY.
   Save output to: <change-dir>/mockup.html
   After review, use contact_supervisor({ reason: "progress_update", message: "[designer:<runId>] ..." }).`
   })
   ```
4. Write checkpoint: `{ phase: "awaiting-designer", designerRunId: "<id>", changeDir: "...", reviewRound: 0 }`
5. **COMPLETE TURN.** Do NOT poll. Wait for intercom trigger.

#### Phase: `awaiting-designer` (triggered by designer intercom)
1. Validate mockup.html: count `<!-- state:` blocks, grep for raw Tailwind colors
2. Capture mockup screenshot via sandbox browser
3. Show BEFORE screenshots to user: `read <change-dir>/screenshots/session-list-desktop.png`, `read session-list-mobile.png`
4. Show mockup to user: `read <change-dir>/screenshots/mockup-final.png`
5. List ALL visual states from mockup.html
6. Ask user for approval via `ask_user({ method: "confirm", title: "Mockup — утверждаем?" })`
7. Update checkpoint: `phase: "showing-mockup"`
8. **COMPLETE TURN.** Wait for user response.

#### Phase: `showing-mockup` (triggered by user reply)
- If user approves → write checkpoint: `{ phase: "implementing", tasksRemaining: [...] }`, proceed to code tasks
- If user requests changes → resume designer: `subagent({ action: "resume", id: "<runId>", message: "<feedback>" })`, write checkpoint: `phase: "awaiting-designer"`, **COMPLETE TURN**

#### Phase: `implementing`
1. Execute code tasks (reference mockup.html for CSS classes, spacing, layout)
2. After all UI tasks complete:
   - Build sandbox: `docker compose -f sandbox/docker-compose.yml up -d --build --wait dashboard`
   - Capture AFTER screenshots: `sandbox/scripts/capture-screenshots.sh <scenario> <output>`
3. Resume SAME designer:
   ```
   subagent({
     action: "resume",
     id: "<designerRunId>",
     message: `Compare AFTER vs MOCKUP.
   AFTER screenshots: <change-dir>/screenshots/after-*.png
   Mockup: <change-dir>/mockup.html
   Use contact_supervisor to report findings.
   If NO differences: message "[designer:<runId>] NO_ISSUES: implementation matches mockup".`
   })
   ```
4. Write checkpoint: `{ phase: "awaiting-review", currentTask: N, reviewRound: N+1 }`
5. **COMPLETE TURN.**

#### Phase: `awaiting-review` (triggered by designer intercom)
1. Read designer findings
2. If **NO_ISSUES**:
   - Show final BEFORE + AFTER screenshots to user via `read`
   - Update checkpoint: `phase: "showing-review"`
   - **COMPLETE TURN**
3. If **issues found**:
   - Send findings + AFTER screenshots to user via intercom
   - Ask user: "Approve these fixes? Any additional changes?"
   - **COMPLETE TURN.** Wait for user.

#### Phase: `showing-review` (triggered by user reply)
- Show BEFORE + AFTER + MOCKUP screenshots to user
- If user approves → write checkpoint: `phase: "done"`, delete checkpoint file
- If user wants more changes → write checkpoint: `phase: "implementing"`, loop

#### Phase: `done`
Delete checkpoint file. Continue with any remaining non-UI tasks.

### Intercom Coordination Rules

**Agent → User:**
- At `awaiting-review` phase: send findings summary + paths to AFTER screenshots
- Format: "Designer found N issue(s). Screenshots: <paths>. Approve? Reply with 'ok', 'fix <details>', 'skip', or 'abort'."
- User feedback takes priority over designer feedback when they conflict

**Agent → Designer:**
- ALL sandbox-designer invocations use `async: true`
- Designer is ALWAYS resumed via `subagent({ action: "resume", id: "<runId>" })` — never re-created
- `reads` parameter SHALL be empty; ALL file paths go in `task`/`message` text
- Task/message MUST include runId for `contact_supervisor` header format

**Screenshot Rules:**
- ALL AFTER screenshots captured via `sandbox/scripts/capture-screenshots.sh` (Docker sandbox with `--build`)
- NEVER use local `agent-browser` for AFTER screenshots
- NEVER skip showing screenshots to user — always use `read` on PNG files

---

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
