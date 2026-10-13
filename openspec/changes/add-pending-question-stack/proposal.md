## Why

An `ask_user` question is only answerable where its session is rendered: the
session card, the chat, or the multi-ask panel. Sessions the user is not looking
at — and especially **hidden or headless sessions** (automation runs, goal
drivers, and the upcoming project-workflow runs) — block silently. The server
already knows every pending prompt (`hasPendingPromptRequests`, the per-session
pending-prompt registry in `browser-gateway.ts`) and push notifications already
fire on "waiting for input", but no surface lists all open questions in one place
or lets the user answer one without first finding and opening its session.

A second problem: a bare question ("Resume or hand back?") is not answerable
without the chat log, which the user often has not seen. The question needs a
self-contained brief that explains what was going on and what each option leads
to.

Third, questions from hidden runs silently expire: `ask_user` auto-cancels after
`askUserPromptTimeoutSeconds` (default 300 s), so an automation or goal
question vanishes before anyone sees it.

This is the prerequisite for attended-but-hidden workflow runs
(`add-project-workflows`, `add-workflow-auto-advance`): their questions must
surface somewhere.

## What Changes

- **NEW global question stack.** A header pill with the open-question count
  opening a dropdown panel (bottom sheet on mobile) that lists **every open
  question** across all sessions the user may see (same visibility as the
  session list), newest-first,
  with a count. Each entry shows the session/change label, a one-line question
  preview, its age, and an origin marker (file-access, chat-gateway, widget-bar).
- Mockup: mockups/question-stack.html (in this change) — header pill, panel /
  bottom sheet, question dialog states; plan + scored rubric in
  `mockups/ui-plan.md`.
- **Click routing.** Activating an entry whose session is **visible** on the board
  navigates to that session and focuses its pending question (or the owning
  widget-bar slot). Activating an entry whose session is **hidden or headless**
  opens a **question dialog** that answers it in place (reusing the existing
  renderers), with an "Open session" escape hatch. File-access prompts are shown
  read-only (they keep their own `operate`-tier answer path).
- **Self-contained question brief.** When a question arrives, the server
  snapshots its context (last assistant message before the ask, recent tool calls,
  workflow-run metadata when present). If the ask carries no context message, or
  the context message is shorter than a threshold, the server generates a brief
  with the `@fast` model role and **stores it on the question record** together
  with the context snapshot (durable, restart-safe, redacted). The brief must be
  understandable without the chat log: what the agent was doing, why it is
  asking, and what each option leads to. Generation is asynchronous, capped, runs
  once, and never blocks answering; a "Summarize" action generates on demand.
  Failure or an unbound role falls back to the raw context.
- **Question REST API.** `GET /api/questions` (list), `GET /api/questions/:id`
  (detail incl. brief + context), `POST /api/questions/:id/answer` (answer or
  cancel). Registered in `route-tiers.ts`, visibility-scoped via identity road
  classification, denylisted for MCP. Per-type answer validation; an atomic latch
  guarantees at most one answer is transmitted.
- **Scoped no-timeout for unattended spawns.** The global 300 s default stays.
  The bridge accepts a per-session ask timeout override via the plugin-spawn
  `extensionConfig` env projection; automation run sessions and goal drivers are
  spawned with infinite wait. Hidden/attended workflow spawns are wired in
  `add-project-workflows` (explicit deferral: that executor does not exist yet).
- **Config.** `questions.autoBrief` and `questions.minBriefChars` settings.
- **Orchestrator skill convention.** `plan-proposal`, `ship-it` and `ship-change`
  put a 2–4 line situation brief in the `ask_user` message, so most questions need
  no generated brief.
- **Unchanged:** push notifications, the per-folder needs-you rollup, inline
  question placement in chat, widget-bar routing. Answering anywhere clears the
  question everywhere.

## Capabilities

### New Capabilities

- `pending-question-stack`: global list of open questions, click routing
  (navigate vs. dialog), stored self-contained brief with fast-model generation,
  and the question REST API.

### Modified Capabilities

- `ask-user-tool`: per-session timeout override from the spawn environment.
- `automation-run-lifecycle`: run sessions wait indefinitely for answers.
- `goal-supervisor`: driver sessions wait indefinitely for answers.
- `shared-config`: `questions.autoBrief` / `questions.minBriefChars` fields.
- `sidebar-header`: row 1 gains the conditional open-questions pill.

## Discipline Skills

- `security-hardening`: a new REST surface answers agent prompts (an answer can
  drive destructive agent actions such as merge); chat content is sent to a
  model for brief generation.
- `observability-instrumentation`: new endpoints and a new external model call
  (brief generation outcome, latency, fallback rate).
- `performance-optimization`: stack updates fan out to every browser; the list
  payload must stay small, with context fetched lazily.
- `doubt-driven-review`: the REST answer endpoint becomes a public API contract.
- `review-code`: before commit.

## Impact

- `packages/server`: question records on the existing pending-prompt registry
  (`browser-gateway.ts`) with one removal funnel, context snapshot, server-side
  `@fast` resolution + brief generator, per-question durable files under
  `~/.pi/dashboard/questions/`, REST routes, `route-tiers.ts`, identity road
  classification, MCP denylist entries.
- `packages/shared`: question wire types; `questions_update` message; prompt
  answer encoder + validator moved here from the client.
- `packages/extension`: `ask_user` message carried on prompt metadata; per-session
  timeout override read from env.
- `packages/automation-plugin`, `packages/goal-plugin`: spawn with the infinite
  ask timeout override.
- `packages/client`: header question pill + panel, question dialog (reuses existing
  ask renderers), navigation to visible sessions; mobile placement.
- Skills: `.pi/skills/plan-proposal`, `ship-it`, `ship-change` gain the
  situation-brief convention.
- Docs: REST reference (`api-reference.md`), `docs/architecture.md` section.
