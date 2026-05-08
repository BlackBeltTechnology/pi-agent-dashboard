## 1. Fix capture-screenshots.sh

- [x] 1.1 Add `--build` flag to `docker compose up` command in `sandbox/scripts/capture-screenshots.sh`
- [x] 1.2 Verify the `--build` flag is present by reading the script after edit
- [x] 1.3 Update `sandbox-designer/SKILL.md` Docker Sandbox Setup section to document that `capture-screenshots.sh` always rebuilds

## 2. Fix sandbox-designer skill contradictions

- [x] 2.1 Remove "Capture AFTER screenshots with `agent-browser` (NOT docker sandbox)" from Design Review Loop section in `sandbox-designer/SKILL.md`
- [x] 2.2 Replace with "Capture AFTER screenshots via Docker sandbox (`sandbox/scripts/capture-screenshots.sh` with `--build`)"
- [x] 2.3 Verify `openspec-apply-change/SKILL.md` step 3 is consistent (already says Docker sandbox) — if not, align

## 3. Add intercom coordination instructions to sandbox-designer skill

- [x] 3.1 Add "Intercom Coordination" section to `sandbox-designer/SKILL.md` with rules:
  - Use `contact_supervisor`, never raw `intercom`
  - `progress_update` after each review completion
  - `need_decision` when finding is ambiguous
  - Message format: `[designer:<runId>]` header, findings count, bullet list with severity tags
  - After screenshots fail to load — stop and report error via `contact_supervisor`
- [x] 3.2 Update Design Review Loop section to use `contact_supervisor` for reporting (not intercom to supervisor name)
- [x] 3.3 Add rule: designer SHALL read all files from `task` text (no `reads` parameter) — already exists, verify it's present and prominent
- [x] 3.4 Add rule: designer SHALL describe screenshots in first message to confirm they loaded correctly
- [x] 3.5 Add rule: designer SHALL reject non-sandbox screenshots (detect by URL or missing sandbox indicator) and refuse to proceed

## 4. Restructure apply-change skill as state machine

- [x] 4.1 Add "Design Process State Machine" section to `openspec-apply-change/SKILL.md` describing:
  - Checkpoint file location and format
  - Phase list and valid transitions
  - Rule: read checkpoint at start of UI design phase, resume from recorded phase
  - Rule: write checkpoint at every phase transition, complete turn at stop-points
- [x] 4.2 Define `init` phase instructions: build sandbox, capture BEFORE screenshots, invoke sandbox-designer with `async: true`, write checkpoint `phase: "awaiting-designer"`
- [x] 4.3 Define `awaiting-designer` phase instructions: triggered by designer completion intercom, validate mockup.html, capture mockup screenshot, show BEFORE + MOCKUP to user, ask approval
- [x] 4.4 Define `showing-mockup` phase instructions: if user approves → transition to `implementing`; if changes requested → resume designer, loop back
- [x] 4.5 Define `implementing` phase instructions: execute code changes, build sandbox with `--build`, capture AFTER via sandbox, resume designer via `subagent({ action: "resume", id, async: true })`, write checkpoint `phase: "awaiting-review"`
- [x] 4.6 Define `awaiting-review` phase instructions: triggered by designer intercom, if NO_ISSUES → show final screenshots to user, transition to `showing-review`; if issues → send findings to user via intercom, ask feedback, fix issues, loop to `implementing`
- [x] 4.7 Define `showing-review` phase instructions: show BEFORE + AFTER + MOCKUP, ask final approval, if yes → `done`, if no → loop to `implementing`
- [x] 4.8 Define `done` phase: delete checkpoint file, continue with non-UI tasks

## 5. Add subagent invocation rules to apply-change skill

- [x] 5.1 Add rule: ALL sandbox-designer invocations MUST use `async: true`, never `async: false`
- [x] 5.2 Add rule: designer SHALL be resumed via `subagent({ action: "resume", id: "<runId>" })`, never re-created from scratch
- [x] 5.3 Add template for initial designer invocation `task` string including: runId, file paths, required states, CSS constraints, `contact_supervisor` instructions
- [x] 5.4 Add template for resume designer invocation `task` string including: runId, updated AFTER screenshot paths, list of fixes applied, "report NO_ISSUES if all fixed"
- [x] 5.5 Add rule: `reads` parameter SHALL be omitted or empty for sandbox-designer invocations

## 6. Add user-in-the-loop instructions to apply-change skill

- [x] 6.1 Add rule: at every review round (phase `awaiting-review`), agent SHALL send findings + AFTER screenshots to user via intercom
- [x] 6.2 Add rule: agent SHALL ask user "Approve? Any additional changes?" before proceeding to fix issues
- [x] 6.3 Add rule: user feedback SHALL take priority over designer feedback when they conflict
- [x] 6.4 Add rule: user can reply "skip", "continue", or "abort" to control the loop
- [x] 6.5 Document intercom message format for user communication (what agent sends, what it expects back)

## 7. Verify sandbox-designer agent has contact_supervisor tool

- [x] 7.1 Check sandbox-designer agent definition: `subagent({ action: "get", agent: "sandbox-designer" })`
- [x] 7.2 Verify `contact_supervisor` is in the agent's tools list
- [x] 7.3 If not, add it to the agent definition

## 8. Validate end-to-end

- [x] 8.1 Read all updated skills to verify no contradictions between apply-change and sandbox-designer
- [x] 8.2 Verify `capture-screenshots.sh` has `--build` by reading the file
- [x] 8.3 Verify all spec scenarios are covered by tasks
- [x] 8.4 Run `openspec status --change "fix-design-process-coordination"` and confirm all artifacts done
