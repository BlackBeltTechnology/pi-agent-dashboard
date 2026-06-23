
# PI Dashboard

## Project Overview

Web-based dashboard for monitoring and interacting with pi agent sessions remotely. Three-component architecture: bridge extension + Node.js server + React web client.

## STOP — Docs-First Gate

**Before any build / run / install / setup / release / "how do I X" question: `grep -i <keyword> docs/faq.md README.md docs/` FIRST. No source reads until that returns nothing.**

If you read a script, config, or source file before grepping docs on a how-to, what-is question, you violated the protocol. Re-grep, then answer.

- ❌ User: "how do I ..." → read `<src files>` → guess answer
- ✅ User: "how do I ..." → `grep -ni '<words>' docs/faq.md` → quote the FAQ entry

- ❌ User: "what is ..." → read `scripts/build-installer.sh`, `forge.config.ts` → guess answer
- ✅ User: "what is ..." → `grep -ni '<words>' docs/index-*.md` → quote the entry

Full protocol (index-first for code questions, file-index splits, etc.) is in [Investigation Protocol — Index First](#investigation-protocol--index-first) below.

## Code Instructions

Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask via `ask_user`.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Never speculate about code you have not opened.** If the user references a specific file, read it before answering. No claims about the codebase without investigation — grounded, hallucination-free answers only.
- Before any major change, check in with the user and confirm the plan.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- **DRY:** if the same pattern appears in multiple places, extract a shared helper/class/component. Don't pre-extract for a single call site.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution (TDD)

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For implementation, use **TDD**: write or update tests first to define expected behaviour, verify they fail, then write the minimal implementation to make them pass.

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Communication

- At every step, give a high-level explanation of what changed — don't dump diffs without summary.
- Use `ask_user` (not plain-text questions) when you need clarification, confirmation, or a choice.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Documentation Update Protocol

**Default assumption: your update does NOT belong in AGENTS.md.** AGENTS.md loads into every agent's context on every turn — every byte costs tokens. Route by kind:

| Kind of update | Goes in |
|---|---|
| New file, or per-file detail / change-history / contract / "See change: …" annotation | Matching per-area split `docs/file-index-<area>.md` (see `docs/file-index.md`). Add row in path-alphabetical order. |
| New top-level area / new split file | New row in `docs/file-index.md` splits table. Pointer in AGENTS.md only if architectural backbone. |
| Data flow, persistence, reconnection, protocol, config reference | `docs/architecture.md` |
| End-user / developer setup, prerequisites, CI badges, project structure | `README.md` |
| Cross-cutting rule EVERY agent needs on EVERY turn (rare) | AGENTS.md, ≤ 200 chars per row, no inline change history |

Rules:

0. **AGENTS.md MUST NOT contain a per-file index.** No `Key Files` table, no per-file rows, no path → purpose lists. When you need a module's key files, read the matching `docs/file-index-<area>.md` split (delegate to a subagent per the Investigation Protocol). New files → row in the split, never here.

1. **Split rows are the canonical per-file record.** Schema = `| \`<path>\` | <purpose> |`, one row per file, path-alphabetical.
   - Purpose field carries everything per-file: one-sentence summary, key exported symbols, contracts/invariants, and `See change: <change-id>` annotations for non-trivial history.
   - Search the matching split for the path first; if a row exists, append/update its purpose in place; else add a new row in alphabetical order.
   - Caveman style (Rule 6 below) applies to row purposes too.

2. **AGENTS.md content beyond per-file rows** — anything that DOES belong here (architecture pointers, build commands, rules every agent needs) stays ≤ 200 chars per line where possible; never enumerate files inline.

3. **If a split grows past ~50 KB**, sub-split it (e.g. `file-index-server-routes.md`) and update `docs/file-index.md`.

4. **Long-form docs** (architecture decisions, rationale, protocol details) belong in `docs/architecture.md` or `docs/<topic>.md`. Reference from AGENTS.md with a one-line pointer, never inline.

5. **When you create a new split doc**, add a one-line pointer in AGENTS.md so future agents find it.

6. **Every write under `docs/` MUST be delegated to a general-purpose subagent with the caveman-style rule passed verbatim in its prompt.** Main agent orchestrates, never edits `docs/` directly.

   **Caveman style** (all `docs/` prose — file-index rows, architecture notes, topic docs):
   - Short declarative fragments. Drop articles (a/an/the) and most copulas (is/are/was) when meaning survives.
   - Subject → verb → object, present tense. No hedging, no marketing voice, no "we", no "you".
   - One fact per line/row. No restating context the file already establishes.
   - Prefer concrete tokens (paths, function names, env vars, ports, exit codes) over prose.
   - Keep symbols/identifiers verbatim; only connective tissue compresses.
   - Example — verbose: "This module is responsible for parsing the user's input and then dispatching it to the correct handler based on the command prefix." Caveman: "Parses user input. Dispatches to handler by command prefix."

Why this exists: AGENTS.md ballooned to 107 KB (~27k tokens) by accreting per-change annotations on every row over months. Split was already done (file-index.md exists) but agents kept appending to AGENTS.md instead.

## Architecture

See [docs/architecture.md](docs/architecture.md) for full details.
- See [docs/electron-bootstrap-flow.md](docs/electron-bootstrap-flow.md) for the Electron app→server bootstrap state machine and end states.

- **Bridge Extension** (`src/extension/`) — Runs in every pi session, forwards events via WebSocket
- **Dashboard Server** (`src/server/`) — Aggregates events, in-memory + JSON persistence, dual WebSocket servers
- **Web Client** (`src/client/`) — React + Tailwind responsive UI
- **Shared Types** (`src/shared/`) — Protocol definitions shared across components

## Commands

```bash
npm install          # Install dependencies
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npm run build        # Build web client (Vite)
npm run dev          # Start Vite dev server
npm run reload       # Reload all connected pi sessions
npm run reload:check # Type-check + reload all pi sessions
pi-dashboard         # Start dashboard server
pi-dashboard --dev   # Start with Vite proxy
```

### Docker

Self-contained all-in-one image (server + pi agent + code-server + zrok + tmux). Files live in `docker/`. Electron gains a wizard "remote" mode (attach to a Docker-hosted URL). Full guide: [`docker/README.md`](docker/README.md). Per-file map: [`docs/file-index-docker.md`](docs/file-index-docker.md).

```bash
cd docker && cp .env.example .env && docker compose up -d --build   # build + run
PI_WORKSPACES="/abs/a:/abs/b" ./up.sh                                # path-identical mounts, auto-pinned
docker compose -f compose.yml -f compose.dev.yml up                 # dev overlay (Vite HMR)
```

## Running Tests

Pipe test output to a tmp file, then grep — avoids re-running to inspect errors:

```bash
npm test 2>&1 | tee /tmp/pi-test.log        # run once, capture all output
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log   # find failures
grep -n -A 20 'FAIL ' /tmp/pi-test.log        # failure + context
```

Always grep the file — never rerun `npm test` just to see errors.

## Cross-Platform QA Testing

Two QA layers, additive — neither replaces the other:
- **VM smoke (`qa/`)** — clean-install + process runtime across OSes (below).
- **Browser E2E (`tests/e2e/`)** — Playwright rendered-UI behaviour (see next section).

VM-based QA testing for verifying clean-state installation and runtime across platforms.

```bash
cd qa
make build-linux-x86    # Build Ubuntu x86 base image (Packer + VMware)
make test-linux-x86     # Clone → boot → run tests → destroy
make manual-linux-x86   # Clone with GUI for manual testing
make clean              # Destroy all cloned VMs
```

| File | Purpose |
|------|---------|
| `qa/Makefile` | Build/test/manual/clean targets for all platforms |
| `qa/packer/*.pkr.hcl` | Packer templates per platform (Ubuntu, Windows, macOS) |
| `qa/packer/scripts/` | Provisioning scripts (common, linux, macos, windows) |
| `qa/packer/vars/` | OS-version-specific variables (ISO URL, checksum, VM specs) |
| `qa/packer/http/` | Auto-install configs (cloud-init, autounattend.xml) |
| `qa/scripts/` | VM lifecycle (clone, wait-ssh, destroy, run-test) |
| `qa/tests/` | Test suite (install, server, websocket, terminal, git) |
| `qa/README.md` | Full setup and usage documentation |

### Playwright Browser E2E (`tests/e2e/`)

**Convention: new browser-level QA scenarios are authored as Playwright specs in `tests/e2e/`, run against the Docker test container.** Do NOT add browser-rendered assertions to `qa/tests/*.sh,*.ps1` (those stay CLI/process smoke).

- Target: `http://localhost:18000` (the disposable `docker/` test harness).
- Lifecycle: Playwright `globalSetup` runs `docker/test-up.sh` and waits for `/api/health` → 200; `globalTeardown` runs `docker/test-down.sh` (discards all state).
- Fast path: `PW_E2E_USE_RUNNING=1 npm run test:e2e` attaches to an already-running container and skips teardown.
- E2E is opt-in (`npm run test:e2e`), separate from the vitest unit run (`npm test`). Requires Docker + `npx playwright install chromium`.
- Spec/tasks: `openspec/changes/add-playwright-e2e/` (harness lands first; scenarios tracked as follow-up tasks).

## Investigation Protocol — Index First

**Before reading source, consult `docs/file-index.md` and the relevant `docs/file-index-<area>.md` split.** The index is the cheapest map of the codebase — every architecturally significant file has a one-line purpose plus change-history pointers. Reading source blind wastes tokens and risks hallucination.

**For "how do I X" / build / run / setup questions: grep `README.md` + `docs/` first.** These already document every supported workflow (build, install, release, QA, troubleshooting). Reading source before checking docs wastes tokens and produces wrong answers (e.g. claiming a feature is missing when it ships). Check `docs/faq.md` for recurring questions.

Workflow for any non-trivial "where is X" / "how does Y work" question:

1. **Pick the split** from `docs/file-index.md` table (shared / extension / server / client / electron / plugins / skills-misc) by path prefix or topic.
2. **Delegate harvesting to a subagent** (`Explore` preferred). Give it:
   - the user's question,
   - the split file(s) to read,
   - explicit instruction: *"return only rows + file paths relevant to the question — no source reads, no speculation."*
3. **Receive a short list** of candidate files (≤ ~10 rows). Only then open source for the ones that matter.
4. If the split lacks coverage, fall back to `rg` / `Explore` over the source tree — and add the missing row per the Documentation Update Protocol.

Why subagents: the splits are large (`file-index-server.md`, `file-index-client.md` each > 20 KB). Loading them into the main context on every question pollutes the budget. A subagent reads the split, returns the 5–10 relevant rows, and discards the rest.

Do **not**:
- Grep source before checking the index.
- Read a whole split file into the main agent's context — delegate.
- Trust the AGENTS.md "Key Files" backbone as exhaustive; it is a subset.

## Subagent Routing

Delegate specialist work to the matching subagent instead of doing it inline. Subagents run in isolated context — keeps main-agent budget free.

| Subagent | Use for |
|---|---|
| `Explore` | Read-only codebase search, file-index harvesting, "where is X" questions. Default for investigation. |
| `react-expert` | React component refactors, hooks, state-management, render perf in `src/client/` and `packages/web/`. |
| `typescript-expert` | Type-system work, generics, strict-mode fixes, async/Promise typing, `.d.ts` authoring. |
| `nodejs-expert` | Server-side async, streams, perf, Node API usage in `src/server/`, `packages/server/`, Electron main process. |
| `tailwind-expert` | Utility-class refactors, responsive breakpoints, design-token audits, dark-mode plumbing. |

Rules:
- One specialist per task. Don't chain react-expert → typescript-expert if a single pass covers it.
- Skip for trivial edits (one-line fix, rename, import tweak). Delegation overhead > benefit.
- Skills (`.pi/skills/`) auto-load by NL trigger — no manual invocation needed. Subagents (`.pi/agents/`) require explicit `Agent` tool call with `subagent_type`.

Context inheritance (this repo ships `pi-dashboard-subagents` producer, NOT pi's stock subagent):
- Default `inheritContext: true` → child receives a **compressed snapshot** of the parent conversation (last N turns + bounded tool output, capped by `maxChars`). Configurable at Settings → general → "Fork parent context into every subagent" or `~/.pi/agent/extensions/pi-dashboard-subagents/config.json`.
- Still pass exact file paths + question in the `task:` string. Compression can drop the specific snippets a specialist needs (`maxChars` cap), and the toggle may be off.
- If file locations are unknown, use `Explore` first — don't rely on the child to re-discover them from compressed history.

## Key Files

The **architectural backbone** lived inline here; that 270-row table was an index, not an instruction. Per-file detail (including change-history annotations) now lives in the split files under `docs/file-index-<area>.md`.

- **Full file map**: [`docs/file-index.md`](docs/file-index.md) — area splits table.
- **Investigation protocol**: see "Investigation Protocol — Index First" above. Delegate harvesting to a subagent; do not load whole splits into the main context.
- **Adding a file**: per "Documentation Update Protocol" above, add a row to the matching `docs/file-index-<area>.md` in path-alphabetical order; do NOT add rows here.

## Build & Restart Workflow

The dashboard has three components that need rebuilding depending on what changed:

### After bridge extension changes (`src/extension/`)
Reload all connected pi sessions to pick up the new bridge code:
```bash
npm run reload          # Reload all pi sessions
npm run reload:check    # Type-check first, then reload
```

### After server changes (`src/server/`, `src/shared/`)
Restart the dashboard server. The server runs TypeScript directly via jiti (pi's TypeScript loader), so no separate build step is needed — just restart:
```bash
# Graceful restart via API (preserves current dev/prod mode)
curl -X POST http://localhost:8000/api/restart

# Or via CLI
pi-dashboard restart              # production mode
pi-dashboard restart --dev        # dev mode

# Manual stop + start
pi-dashboard stop && pi-dashboard start
pi-dashboard stop && pi-dashboard start --dev
```

### After client changes (`src/client/`)
- **Dev mode**: Vite hot-reloads automatically, no action needed. Start with `npm run dev`.
- **Production mode**: Rebuild the client and restart the server:
  ```bash
  npm run build
  curl -X POST http://localhost:8000/api/restart
  ```

### After OpenSpec apply finishes (full rebuild)
When an openspec-apply-change skill completes implementation, do a full rebuild and restart:
```bash
npm run build
curl -X POST http://localhost:8000/api/restart
npm run reload
```
`full-rebuild.ts` = **deploy** the checked-out dev version to the local running instance. NOT a feature-implementation step; worktree / Docker-isolated work does not run it.

### Code-review gate (implementation phase)
At implementation completion, before commit, run the advisory CodeRabbit gate on the diff. **Server-independent + worktree-safe** (no build, no restart) — works in a git worktree and alongside the Docker-isolated instance:
```bash
npx tsx .pi/skills/implement/scripts/review-changes.ts          # uncommitted diff (default)
npx tsx .pi/skills/implement/scripts/review-changes.ts -t committed --base main
SKIP_CR_REVIEW=1 npx tsx .pi/skills/implement/scripts/review-changes.ts   # skip
```
Warn-and-continue, never blocks: CodeRabbit is cloud rate-limited (no local model); on limit / missing CLI / auth failure it defers to a later cycle and exits 0. Fix Critical/Warning, then commit. Triage + fix loop: `code-review` skill.

### Check current mode
```bash
curl -s http://localhost:8000/api/health | jq .mode
# Returns "dev" or "production"
```

### Dev mode with production fallback
In `--dev` mode, the server proxies to Vite for HMR. If Vite is not running, it **automatically falls back** to serving the production build from `dist/client/`. This means `pi-dashboard start --dev` always works — no 502 errors.

### Fault-tolerant restart
- `POST /api/restart` waits for the old server to exit, starts a new one, and verifies health
- `POST /api/restart` with body `{"dev": true}` or `{"dev": false}` switches modes
- `pi-dashboard stop` kills stale processes holding the ports (via `lsof`), not just the PID file
- **Single restart path** (change: fix-restart-bridge-auto-start-race): `/api/restart` is the single source of truth. `pi-dashboard restart` (CLI) probes `isDashboardRunning(port)` and **delegates to `/api/restart`** when the dashboard is up; only when no dashboard is running does it fall back to local `cmdStop` + `cmdStart`. The `restart-helper.ts` orchestrator runs detached, kills the previous PID explicitly (SIGTERM → SIGKILL), then spawns the replacement. Before exit, the server broadcasts `server_restarting { reason, quiesceMs }` to every connected pi bridge so bridges suppress their auto-start spawn step for the quiesce window (5 s for restart, 60 s for shutdown) and don't race the orchestrator. Discovery + reconnection still run during the window so bridges pick up the new server as soon as it advertises.

## OpenSpec Conventions

In a git worktree, use the worktree parent's `.pi/skills` (opsx/OpenSpec skills) — resolve OpenSpec skills from the main repo root, not the worktree checkout.

When creating OpenSpec change artifacts, always place them at `openspec/changes/<name>/` — never nest under subdirectories like `active/` or `archive/`. Prefer using `openspec change new <name>` CLI to scaffold the directory structure correctly.

## Diagram Style

When creating diagrams, use Mermaid syntax (```mermaid blocks) instead of ASCII box drawings. This applies to explore mode, design documents, and all other artifacts.


