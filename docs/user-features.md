# PI Dashboard — User-Facing Features

Curated subset of [`features.md`](features.md) that can be communicated to end users. Internal plumbing, CI/QA, packaging and refactor capabilities are excluded.

## Monitor & control your agents

- See every running pi session live in the browser — messages stream in as they happen
- Send prompts and slash commands from the browser; type mid-turn and it queues
- Per-session stats: tokens, cost, model, thinking level, context-usage bar, elapsed time
- Start new sessions from the dashboard (headless, tmux, or Windows Terminal)
- Resume ended sessions, or fork a session from any earlier message
- Stop a runaway agent: soft abort → force kill, session preserved for resume
- Rename sessions, auto-naming, tags, hide/show cards, drag-to-reorder, search & filter
- "Needs you" rollup — see at a glance which sessions are waiting on your answer

## Chat experience

- Full markdown: syntax highlighting, Mermaid diagrams, LaTeX math, tables
- Images: paste from clipboard, inline screenshots/tool results, click-to-lightbox
- Slash-command autocomplete, `@file` autocomplete, `!`/`!!` shell commands, inline terminal
- Per-session drafts survive navigation; ↑/↓ recalls your prompt history
- Grouped tool calls, per-turn change summary with line counts, clickable URLs in output
- Smooth on huge transcripts — virtualized, no lag on long sessions

## Workspace

- Group sessions by project folder; pin folders, build workspaces, drag to reorder
- 4 themes, light/dark, MDI icons
- Mobile-friendly: swipe drawer, touch targets, install as a PWA
- English + Simplified Chinese UI

## Built-in editor, files, terminal

- Monaco code editor inside the dashboard, side-by-side with chat
- File browser, diff viewer, markdown preview with search and zoomable diagrams
- Real terminal per folder (xterm.js), as a tab next to the editor
- Live preview of a local dev server inside the app
- Edit AGENTS.md / instructions files directly, project or global scope

## Git & worktrees

- Branch shown per folder; switch branches from the UI
- Create and remove git worktrees from a dialog, with optional auto-init on spawn
- Uncommitted-changes badge with ahead/behind; review the diff and commit selected files from the card (AI-drafted commit message)

## Automation

- **Flows**: visual dashboard of multi-agent flows — agent cards, graph, live progress, abort, autonomous mode
- **Automations**: trigger sessions on a cron schedule or when a file appears
- **Goals**: set a goal with success criteria and budget; a supervisor keeps the agent working toward it
- **Subagent inspector**: watch subagents work live, pop out into a full view

## Knowledge base

- Per-folder searchable index of your markdown docs (fast full-text search)
- Auto-reindexes as you edit, stats and settings per folder

## Models & providers

- Sign in with one click: Anthropic, OpenAI Codex, GitHub Copilot, Gemini CLI, Antigravity
- Or paste API keys; add your own OpenAI/Anthropic/Google-compatible endpoint with a Test button
- Switch models per session from the status bar; credentials apply to running sessions instantly
- Assign models to roles and save role presets
- Retry policy editor; quota/limit info surfaced
- Built-in OpenAI-compatible proxy — point any other tool at your dashboard's models

## Extensions & plugins

- Browse, search, install, update, remove pi packages from the UI (global or per-project)
- Curated "recommended extensions" list
- Extensions can add their own dashboard screens and settings panels
- Bundled skills: `/dashboard:*` commands, browser automation, doctor, project-init

## OpenSpec workflow

- Browse changes, specs and archive; kanban-style board
- Tick tasks off from the UI, attach a proposal to a session, launch explore/new-change dialogs

## Access from anywhere

- Discover dashboards on your network automatically (mDNS), switch servers from the header
- Share securely over the internet with a zrok tunnel + QR code
- Pair a phone by scanning a QR; OAuth login (GitHub, Google, Keycloak, OIDC) with an allowlist

## Desktop app

- Native app for macOS/Windows/Linux with setup wizard — no Node install needed
- Tray icon, auto-update, window state, built-in Doctor diagnostics
- Connect to a remote or Docker-hosted dashboard instead of running locally

## Extras you get for free

- Convert PDF/DOCX/PPTX/XLSX/HTML to markdown and summarize them
- Transcribe meeting recordings to speaker-labelled subtitles
- Generate images (Gemini) and video storyboards (Veo)
- UI mockup design loop with accessibility scoring
- Optional grammar/spell check in the composer

## First run: connect, create, start

- Landing shows one ordered list, 3 steps: connect a model provider → create first project → start first session
- Progress line `n of 3 done` above list
- First pending step expanded, one primary button
- Done steps: one line + check
- Locked / later steps: one line, no controls — `Needs …` or `Waits for step 1`
- Step ②: field `Project name` prefilled `my-first-project`, primary `Create project`
- Step ②: link `Use an existing folder…` opens folder browser
- Create makes or reuses `~/Projects/<name>`; `Projects` root created if absent; never above home
- Project pinned automatically
- Existing folder: done row adds "That folder already existed, so it was pinned as-is." Gone once Landing unmounts
- Name rules: single path segment; no `/ \ : * ? " < > |`, no control chars, no trailing `.` or space, no `CON` `PRN` `AUX` `NUL` `COM0-9` `LPT0-9` (any extension), ≤255 UTF-8 bytes
- Invalid name: error between label and field; input kept
- Symlinked project folder must resolve inside `~/Projects`; symlinked `~/Projects` root allowed
- Claude tool calls: finishing `anthropic` sign-in in Settings ▸ Providers auto-installs `@blackbelt-technology/pi-anthropic-messages` (global)
- Auto-install skipped when that package already active in pi, or on probe import failure. Sign-in never blocked
- Auto-install does not run on API-key saves, other providers, custom endpoints, or page loads while already connected
- Install status shows on Anthropic row and Landing step ①:
  - installing: info
  - installed: "applies on next pi session start"
  - failed: warning, plain sentence first, `Retry install`, raw installer output in collapsed `Details`
- Landing `Install` appears when `anthropic` signed in and peer not active, with no auto state (e.g. sign-in finished after Settings closed)
- Status clears on reload, sign-out, or once probe resolves
