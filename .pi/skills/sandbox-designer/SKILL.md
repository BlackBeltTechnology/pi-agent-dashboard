---
name: sandbox-designer
description: Design model for generating Tailwind HTML mockups from screenshots of real UI. Receives before-screenshots + user stories, returns mockup.html with all visual states using project Tailwind tokens.
license: MIT
metadata:
  author: pi-dashboard
  version: "1.2"
---

# Sandbox Designer

Vision-capable agent that receives before-screenshots and user stories, then produces a Tailwind HTML mockup showing the redesigned UI with all visual states.

**Required model:** Vision-capable (Gemini Pro, Claude Sonnet/Opus, GPT-4o).
**Thinking:** xhigh recommended for complex layouts.

## Input / Output Contract

**Input:**
- **Before-screenshots:** PNG files of the current dashboard UI (saved in `<change-dir>/screenshots/`)
- **Proposal + Specs:** `proposal.md` (user stories ARE the scenarios) and `specs/` (requirements). Designer derives ALL needed visual states from these.
- **Design context (optional):** `design.md` if already created

**Output:**
- `<change-dir>/mockup.html` — a single HTML file containing:
  - Valid HTML
  - **CSS custom properties only** — `bg-[var(--bg-tertiary)]`, `text-[var(--text-primary)]`, not raw colors
  - One `<!-- state: <name> -->` HTML comment per visual state
  - Every `<!-- state: ... -->` comment immediately precedes the HTML block for that state

## CSS Constraint — CRITICAL

Use ONLY project CSS custom properties via Tailwind arbitrary values:

```
bg-[var(--bg-primary)]     bg-[var(--bg-secondary)]     bg-[var(--bg-tertiary)]
bg-[var(--bg-surface)]     text-[var(--text-primary)]    text-[var(--text-secondary)]
text-[var(--text-tertiary)] text-[var(--text-muted)]
border-[var(--border-secondary)]  border-[var(--border-subtle)]
```

**NEVER use raw Tailwind colors** (bg-gray-800, text-white, border-gray-700).
Accent colors (blue-500, green-500, yellow-500, purple-500, red-500) allowed for status.

## Communication with Orchestrator

The orchestrator provides a list of required `<!-- state: -->` blocks in the task text.
If the designer discovers additional states that should be covered
(e.g. specs mention a state not in the list, or screenshots reveal a variant):
- Write the additional state anyway and note it in the output.
- Report via `contact_supervisor` (see Intercom Coordination below).

If screenshots failed to load — stop immediately, do NOT generate from imagination.
Report via `contact_supervisor({ reason: "need_decision", message: "ERROR: screenshots failed to load" })`.

**Screenshot validation on first load:** In the designer's first `contact_supervisor` message,
describe what is seen in the screenshots (specific colors, layouts, elements).
If the description is generic or wrong, screenshots didn't load — stop and report error.

**Reject non-sandbox screenshots:** If AFTER screenshots appear to come from local
`agent-browser` (URL shows `localhost:8000` without sandbox indicators, or screenshots
match a previously-seen stale version), report via `contact_supervisor`:
"ERROR: screenshots not from sandbox — may show stale code" and refuse to proceed.

## Intercom Coordination

During the review loop (apply phase), the designer runs as an async subagent and
communicates with the supervisor via `contact_supervisor`. NEVER use raw `intercom()`.

**Fallback on name conflict:** If `contact_supervisor` returns "Multiple sessions named X
are connected", use `intercom` with the parent session ID provided in the task:
```
intercom({ action: "ask", to: "<parent-session-id>", message: "<question>" })
```
The parent session ID is passed in the task text as `Parent session ID: <uuid>`.

### When to use progress_update

After completing a review (comparing AFTER screenshots vs mockup), send findings:
```
contact_supervisor({
  reason: "progress_update",
  message: `[designer:<runId>] Found N issue(s):
- [SEVERITY] <element>: expected <mockup-value>, got <after-value> — <action>
- ...`
})
```

Severity tags: `[CRITICAL]` (layout broken, missing element), `[MAJOR]` (wrong color/size/spacing),
`[MINOR]` (1-2px off, cosmetic).

If NO differences found:
```
contact_supervisor({
  reason: "progress_update",
  message: "[designer:<runId>] NO_ISSUES: implementation matches mockup"
})
```

Do NOT mark the task as complete after sending — wait for the supervisor to re-invoke you
with new instructions.

### When to use need_decision

When a finding is ambiguous and the designer cannot determine if it's intentional:
```
contact_supervisor({
  reason: "need_decision",
  message: `[designer:<runId>] NEED DECISION:
Element: <element>
Mockup: <mockup-value>
After: <after-value>
Question: Is this an intentional deviation or a bug?`
})
```

Wait for supervisor reply before continuing. Classify based on answer:
- "intentional" → exclude from issue list
- "fix" → include as finding

## States to Cover

For session card / UI changes, cover at minimum:
- `<!-- state: desktop-sidebar -->` — cards + toolbar at full width
- `<!-- state: mobile-sidebar -->` — cards at 375px width
- `<!-- state: desktop-card-streaming -->` — card with streaming status
- `<!-- state: desktop-card-idle-selected -->` — idle card, selected (blue border)
- `<!-- state: desktop-card-ended -->` — ended card
- `<!-- state: desktop-tools-dropdown -->` — Tools menu open
- Additional states from user stories

**Theme requirement:** Every state MUST be shown in BOTH light and dark theme variants.
Add `<!-- theme: light -->` and `<!-- theme: dark -->` comments within each state block,
or duplicate each state for both themes.

**Label requirement:** Every `<!-- state: -->` block MUST be preceded by a visible `<h2>` heading
with the human-readable state name (e.g. `<h2>Desktop Session List</h2>`).
This makes the mockup scannable when opened in a browser.

## Self-Validation

After generating `mockup.html`:
1. Count `<!-- state:` comments — must match the requested state count
2. Verify NO raw Tailwind colors (grep: `bg-gray-`, `text-white`, `border-gray-`, `bg-slate-`, etc.)
3. Verify CSS custom property syntax used everywhere
4. Verify BOTH light and dark theme variants present for each state
5. Verify visible `<h2>` labels above each `<!-- state: -->` block
6. If ANY check fails — fix and re-check before reporting done

## Approval Workflow — MANDATORY

After designer completes, follow these steps IN ORDER. Do NOT skip any step.

### Step 1: Show BEFORE screenshots to user

ALWAYS show the user what was sent to the designer:
```
read <change-dir>/screenshots/session-list-desktop.png
read <change-dir>/screenshots/session-list-mobile.png
```

### Step 2: Show AFTER mockup to user

```
read <change-dir>/screenshots/mockup-final.png
```

### Step 3: List ALL visual states for approval

Output a checklist of every `<!-- state: -->` block from mockup.html so the user can verify:
```
grep '<!-- state:' <change-dir>/mockup.html
```

Present as a numbered list:
```
1. desktop-sidebar ✅
2. desktop-card-idle ✅
3. mobile-card-streaming ✅
...
```

### Step 4: Ask for approval

```
ask_user({
  method: "confirm",
  title: "Mockup — утверждаем?",
  message: "N состояний. [краткое описание изменений]. Нужны правки?"
})
```

If user says NO — ask what to change, then `subagent({ action: "resume", ... })`.
If user says YES — proceed to tasks.

## Design Review Loop (apply phase)

During implementation, the designer is used for critique — comparing AFTER screenshots against mockup:

1. Capture AFTER screenshots via Docker sandbox (`sandbox/scripts/capture-screenshots.sh` with `--build`)
2. Invoke designer: `subagent({ agent: "sandbox-designer", async: true, task: "Compare AFTER vs MOCKUP..." })`
3. Fix ALL reported issues
4. Rebuild sandbox with `--build`, re-capture, re-invoke SAME designer via `subagent({ action: "resume", id: "<run-id>", message: "Re-review..." })`
5. **Loop until designer responds with NO_ISSUES** — do NOT stop before that

## Agent Invocation

**CRITICAL — Invocation Rules:**

1. **Async mode.** Designer runs as `async: true` subagent. Communicates via `contact_supervisor`.
2. **NO `reads` parameter.** ALL file paths (screenshots, proposal, specs, design) go in the `task` text.
3. **Use contact_supervisor, NOT raw intercom.** Designer never calls `intercom()` directly unless `contact_supervisor` fails with "Multiple sessions" error — then fallback to `intercom({ to: "<parent-session-id>" })`.
4. **Parent session ID.** The task text MUST include `Parent session ID: <uuid>` so the designer can fallback if `contact_supervisor` fails with a session name conflict.
5. **Validate screenshots on load.** First message MUST describe what is seen in screenshots.
6. **Reject non-sandbox screenshots.** If screenshots appear local/stale, report error and refuse.
7. **Before screenshots MUST be shown to user.** Use `read` on the BEFORE screenshots that were sent to the designer.
8. **Mockup screenshot MUST be shown to user.** Use `read` on `mockup-final.png`.
9. **All states MUST be listed** before asking for approval.

```
subagent({
  agent: "sandbox-designer",
  async: true,
  task: `Generate mockup.html for <change>.

Parent session ID: <your-current-session-uuid>

Read these screenshots first to understand the current UI:
- <change-dir>/screenshots/desktop-overview.png
- <change-dir>/screenshots/mobile-overview.png

Read these design documents:
- <change-dir>/proposal.md
- <change-dir>/design.md

Read these specs:
- <change-dir>/specs/<capability>/spec.md

Required states: ...

CSS constraint: CSS custom properties ONLY. No raw Tailwind colors.

Save output to: <change-dir>/mockup.html`
})
```

**After agent completes:**
1. Validate mockup.html (state count, no raw colors)
2. Capture mockup screenshot via sandbox browser
3. `read <change-dir>/screenshots/mockup-final.png` — show to user
4. Ask user for approval with `ask_user`
5. If changes needed — `subagent({ action: "resume", id: "<run-id>", message: "<feedback>" })`

## Docker Sandbox Setup

The Docker sandbox MUST be pre-built with all dependencies:

**Dockerfile requirements:**
- `chromium` package in apt-get install list (Debian bookworm)
- `agent-browser` npm package (not `@mariozechner/agent-browser`)
- `run-scenarios.sh` uses `agent-browser` binary (not `browser`)
- Python 3 for scenario JSON parsing
- Chromium started via entrypoint: `chromium --headless --disable-gpu --no-sandbox --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 &`

**Before invoking the designer, verify sandbox is healthy:**
```bash
docker compose -f sandbox/docker-compose.yml up -d --wait dashboard
```

**Screenshot capture always rebuilds:** `sandbox/scripts/capture-screenshots.sh` passes `--build` to `docker compose up` on every invocation. The image is rebuilt from the current worktree, so screenshots always reflect the latest code. This adds 30-90 seconds per capture round but guarantees correctness.
