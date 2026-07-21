# PI Dashboard

Web dashboard to monitor + control pi agent sessions remotely. Three components: bridge extension + Node server + React client. Full architecture: [docs/architecture.md](docs/architecture.md).

## Docs-First Gate — kb before grep (per-turn doctrine)

`kb_*` tools return a one-line purpose + key exports per file instead of raw bytes. **This gate fires on the ACTION, not the intent** — before you `grep`/`rg` a symbol, `cat`/Read a file to learn its purpose, or chase an import, the kb call goes first. It fires **even mid-task when you already know the file**. When your reflex is the left column, run the right instead:

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName"` — find where a fn/type/const lives | `kb_search --doc-type agents "SymbolName"` |
| `grep -rn "topic" src/` — how does X work / where's X handled | `kb_search "feature topic"` |
| `cat`/`Read` a file to learn its purpose before editing | `kb agents <path>` — purpose + exports + `See change:` |
| chase imports / callers across files | `kb_neighbors <path\|heading>` |
| read one doc section in full | `kb_get <path> <section>` |
| build / run / install / setup / release / "how do I X" | `grep -i <kw> docs/faq.md README.md docs/` — then quote |

`kb_search` indexes repo markdown (`docs/ openspec/ packages/ .pi/`). `ctx_search`/`memory_search` index session memory, NOT repo docs — different corpus.

**Per-file record = directory `AGENTS.md` tree.** Every file (incl. `docker/ scripts/ .pi/skills/ public/ qa/ tests/ .github/`) has a row in its directory's `AGENTS.md`. `docs/` topic docs + root config (`biome.json`, `playwright.config.ts`, `.pi-test-harness.json`) → `docs/AGENTS.md`. `kb agents <path>` returns the root→nearest chain; `kb_search --doc-type agents` ranks rows by symbol/topic. Tree files are tiny — no subagent needed. The `docs/file-index*.md` splits are RETIRED.

**Fall-through:** if the kb call returns nothing relevant, `rg`/source read is allowed — then add the missing directory-`AGENTS.md` row per the Documentation Update Protocol. kb does NOT replace grep; it goes first. For "how do I X"/build/run/setup, grep `README.md` + `docs/` (incl. `docs/faq.md`) before reading source.

## Code Instructions (per-turn doctrine)

Behavioral guidelines to reduce common LLM mistakes. Bias toward caution over speed. Trivial tasks → judgment.

1. **Think before coding.** State assumptions; if uncertain, ask via `ask_user`. Present multiple interpretations, don't pick silently. Push back when a simpler approach exists. **Never speculate about code you haven't opened** — consult the doc tree (`kb agents`/`kb_search`), then read the file. Confirm the plan before any major change.
2. **Simplicity first.** Minimum code that solves the problem. No speculative features/abstractions/flexibility/error-handling for impossible cases. DRY: extract a shared helper when a pattern repeats (not for a single call site). "Would a senior engineer call this overcomplicated?" If yes, simplify.
3. **Surgical changes.** Touch only what you must. Don't improve/refactor/reformat adjacent code. Match existing style. Mention unrelated dead code, don't delete it. Remove only orphans YOUR change created. Every changed line traces to the request.
4. **Goal-driven (TDD).** Turn tasks into verifiable goals. Write/update tests first, verify they fail, then minimal implementation to pass. State a brief plan for multi-step tasks (step → verify).
5. **Communication.** High-level summary of what changed each step. Use `ask_user` (not plain text) for clarification/choices.

## Investigation Protocol — Index First

Before reading source, consult the per-file record (directory `AGENTS.md` tree, above). Workflow for "where is X"/"how does Y work": (1) `kb_search` first (FTS5+BM25 over repo markdown); (2) `kb agents <path>` for the root→nearest chain of a known file; (3) receive ≤~10 candidates, then open source; (4) if the tree misses, fall back to `rg`/`Explore`, then add the missing row. Do NOT grep source before the kb call; do NOT recreate `docs/file-index*.md`.

## Documentation Update Protocol

**Default: your update does NOT belong in AGENTS.md** — it loads every turn, every byte costs tokens. Route by kind:

| Kind of update | Goes in |
|---|---|
| New file in ANY directory, or its per-file detail / change-history / `See change:` | Nearest directory `AGENTS.md`. Row `| \`<basename>\` | <purpose> |`, path-alphabetical. New dir → `kb dox init`. |
| New root config file or `docs/` file | `docs/AGENTS.md`, same row schema. |
| New top-level source area / directory | Scaffold its `AGENTS.md` via `kb dox init`. |
| Data flow, persistence, reconnection, protocol, config reference | `docs/architecture.md` |
| End-user/dev setup, prerequisites, CI, project structure | `README.md` |
| Cross-cutting rule EVERY agent needs EVERY turn (rare) | AGENTS.md, ≤200 chars/row, no inline change history |
| Source-of-truth change the doctor skill derives | `doctor --regenerate <module>` — never hand-maintain version/name tables |

Rules (full rationale + caveman-style spec: [docs/architecture.md](docs/architecture.md)):
- **The ROOT AGENTS.md MUST NOT contain a per-file index** — no Key Files table, no per-file rows. Per-file records live in the directory `AGENTS.md` tree.
- **Purpose row** carries everything per-file: one-line summary, key exports, contracts, `See change:`. Update in place if present, else insert alphabetically.
- **Tree files stay small** (~1 row/file, cap 30 KB `AGENTS_BYTE_CAP`). Flat dirs with many files split file-based: rows >200 chars promote to a pull-only `<File>.AGENTS.md` sidecar; dir row keeps a summary + `→ see`. Run `node scripts/split-large-agents.mjs <path> --write`. `kb dox lint` flags `over-threshold`.
- **Every write under `docs/`** (prose AND `docs/AGENTS.md`) is delegated to a general-purpose subagent (DocScribe) with the **caveman-style** rule passed verbatim — short declarative fragments, drop articles/copulas, subject→verb→object, one fact per line, concrete tokens (paths/fns/env/ports) over prose, symbols verbatim. Main agent orchestrates, never edits `docs/` directly. Source-tree rows under `packages/`+non-source areas: main agent edits directly.

## Architecture

Full details: [docs/architecture.md](docs/architecture.md). Electron bootstrap: [docs/electron-bootstrap-flow.md](docs/electron-bootstrap-flow.md). Doctor skill: [docs/doctor-skill.md](docs/doctor-skill.md).

- **Bridge Extension** (`src/extension/`) — runs in every pi session, forwards events via WebSocket
- **Dashboard Server** (`src/server/`) — aggregates events, in-memory + JSON persistence, dual WebSocket servers
- **Web Client** (`src/client/`) — React + Tailwind responsive UI
- **Shared Types** (`src/shared/`) — protocol definitions

## Commands

```bash
npm install          # deps
npm test             # all tests (vitest)
npm run build        # build web client (Vite)
npm run dev          # Vite dev server
npm run reload       # reload all connected pi sessions
pi-dashboard         # start server   (--dev = Vite proxy)
```

**Docker** (self-contained all-in-one: server + pi + code-server + zrok + tmux). Full guide: [`docker/README.md`](docker/README.md); per-file map: [`docker/AGENTS.md`](docker/AGENTS.md).
```bash
cd docker && cp .env.example .env && docker compose up -d --build
PI_WORKSPACES="/abs/a:/abs/b" ./up.sh
```

## Running Tests

Pipe once to a tmp file, then grep — never rerun to inspect errors:
```bash
npm test 2>&1 | tee /tmp/pi-test.log
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log
```

## Build & Restart Workflow

**Rebuild/restart procedure — extension→reload, server→restart, client→build+restart, openspec-apply→full rebuild — plus the code discipline for landing a change: the `implement` skill** (auto-loads on "rebuild", "after edit", "implement X", "how do I land this"). Two-tier code review (`review-code` inline + opt-in CodeRabbit ship gate), Biome quality ratchet (`code-quality` skill, `npm run quality:changed`), and the discipline-skill checkpoint table also live there. Full quality ref: [`docs/code-quality.md`](docs/code-quality.md).

Quick reference:
```bash
npm run reload                              # after src/extension/ changes
curl -X POST http://localhost:8000/api/restart   # after src/server|src/shared changes (jiti — no build)
npm run build && curl -X POST .../api/restart    # after src/client changes (production)
curl -s http://localhost:8000/api/health | jq .mode   # dev | production
```
`/api/restart` is the single restart source of truth (CLI `restart` delegates to it when the dashboard is up). `--dev` proxies to Vite with automatic production fallback. `full-rebuild.ts` = deploy checked-out dev to the local instance; NOT a feature step.

## Cross-Platform QA

Two additive layers: **VM smoke** (`qa/`, clean-install + runtime per OS) and **Playwright browser E2E** (`tests/e2e/`, rendered-UI behaviour vs the docker harness). New browser scenarios → Playwright specs, NOT `qa/tests/*.sh`. Full setup: [`qa/README.md`](qa/README.md). E2E is opt-in (`npm run test:e2e`); harness lifecycle via `docker/test-up.sh`/`test-down.sh`.

## Subagent Routing

Delegate specialist work to the matching subagent (isolated context). Explicit `Agent` call with `subagent_type` required (skills auto-load by NL; subagents don't). One specialist per task; skip for trivial edits.

| Subagent | Use for |
|---|---|
| `Explore` | Read-only search / "where is X" when the tree misses (per-file lookups use `kb agents` directly). |
| `react-expert` | React refactors/hooks/state/render-perf in `src/client/`, `packages/web/`. |
| `typescript-expert` | Type-system, generics, strict-mode, async typing, `.d.ts`. |
| `nodejs-expert` | Server async/streams/perf in `src/server/`, `packages/server/`, Electron main. |
| `tailwind-expert` | Utility-class refactors, breakpoints, tokens, dark-mode. |
| `Audit` | Deep security+perf pass on a diff (read-only findings; parent fixes). |
| `DocScribe` | Write `docs/` prose in caveman style (Rule-6 target). Returns tree rows for parent to apply. |
| `SessionGuideline` | Turn a session into a how-we-did-it playbook. |

**Apply-loop spawn checkpoints** (signal in diff/tasks.md → spawn): touches auth/secrets/PII/untrusted-input/webhooks or a latency budget → `Audit`; contextFiles list large → `Explore`; a change landed + `docs/` needs prose → `DocScribe`.

**Discipline-skill checkpoints** (invoke the `eng-disciplines` skill when the signal appears): auth/untrusted-input/secrets/PII → `security-hardening`; latency/throughput budget or large-data path → `performance-optimization`; new endpoint/job/external-call → `observability-instrumentation`; irreversible step (migration/public-API) before it stands → `doubt-driven-review`; bug mid-implementation → `systematic-debugging`; opaque runtime state (jiti/PTY/WS) → `node-inspect-debugger`; non-trivial change + tests pass before commit → `review-code`; works but feels heavy → `code-simplification`.

Context inheritance: this repo ships `pi-dashboard-subagents` (default `inheritContext: true` → child gets a compressed parent snapshot, capped by `maxChars`). Still pass exact file paths + the question in `task:`; use `Explore` first if locations are unknown.

## OpenSpec Conventions

In a worktree, resolve OpenSpec skills from the main repo root, not the checkout. Place change artifacts at `openspec/changes/<name>/` (never under `active/`/`archive/`); prefer `openspec change new <name>`. In `proposal.md`, add a `## Discipline Skills` line naming the `eng-disciplines` skills its tasks trigger (per the checkpoint tables above); omit only when none apply. Use `ask_user` (batch for multi-question) for any needed input.

## Key Files

The architectural backbone is NOT indexed here. Per-file record = the directory `AGENTS.md` tree, via `kb agents <path>` (root→nearest chain) or `kb_search --doc-type agents`. Docs tree node: [`docs/AGENTS.md`](docs/AGENTS.md). Adding a file → nearest directory `AGENTS.md` (never this root file).

## Diagram Style

Use Mermaid (```mermaid blocks), not ASCII box drawings — explore mode, design docs, all artifacts.
