## Why

The dashboard exposes ~50 REST endpoints (`api-reference.md`, 594 lines) and an existing skill (`.pi/skills/pi-dashboard/`) that wraps every endpoint with a curl helper script. Today, driving the dashboard from a pi session requires the LLM to read the skill, choose an endpoint, and invoke `Bash` with the right curl. That works, but for **read-only, single-shot operations** ("which sessions are active?", "what's the diff in session abc?", "is the tunnel up?") it's slow, expensive, and non-deterministic — every status check costs tokens and may produce slightly different formatting each time.

Slash commands (`/foo`, expanded by `prompt-expander.ts` → `command-handler.ts`) are the right shape for these one-shot operations. The expander already supports the colon-aliasing convention (`/foo:bar` → `foo-bar.md`), so a `/dashboard:*` namespace fits naturally. But there's a gap: the slash pipeline today **always routes the expanded template to the LLM as a user message**. There is no way for a slash command to render output deterministically without invoking the model.

The current four pipelines — `!cmd` (bash + LLM), `!!cmd` (bash, no LLM), `/cmd` (template → LLM), and the hard-coded set (`/reload`, `/new`, `/model`, `/quit`, `/compact` — direct, no LLM) — leave a clean missing slot: **a slash command whose body is bash and whose output renders directly without LLM involvement**. We need that pipeline, and a curated `/dashboard:*` command set that uses it.

## What Changes

- **NEW**: A `/dashboard:<resource>-<verb>` namespace covering ~30 dashboard operations grouped into 7 resource families (`server-*`, `session-*`, `proposal-*`, `flow-*`, `git-*`, `peer-*`, `pin-*`). Naming grammar fixed: singular resource, hyphen-joined verb (e.g. `/dashboard:session-list`, `/dashboard:session-info`, `/dashboard:proposal-attach`).
- **NEW**: Frontmatter directive `executable: bash` on prompt template files. When the expander encounters a template with this flag, the bridge takes a new pipeline: render the body as bash via `pi.exec()`, emit a `bash_output` event for client rendering, and **never call the LLM**. A companion flag `excludeFromContext: true` (default for `executable: bash`) skips appending the result to LLM context, mirroring `!!` semantics.
- **NEW**: New `ParsedPrompt` variant `{ type: "slash-exec"; command: string; excludeFromContext: boolean; argsString: string }` returned by `parseSendPrompt` when the resolved template carries `executable: bash`. The `command-handler.ts` switch dispatches this variant to the existing `handleBashCommand` helper — no new bash-execution code path.
- **NEW**: Argument substitution convention for exec-mode templates: positional args via shell `$1`, `$2`, ... by spawning `sh -c "<body>" -- <argsString-tokens>`. Optional named env via `PI_DASHBOARD_SESSION_ID`, `PI_DASHBOARD_CWD` injected by the bridge for ergonomics ("default to current session/cwd if no arg supplied").
- **NEW**: Initial command set under `~/.pi/prompts/` (or per-skill subdir, see design.md):
  - **Read-only / LLM-free** (`executable: bash`): `server-health`, `server-config`, `server-tunnel-status`, `session-list`, `session-list-active`, `session-list-here`, `session-info <id>`, `session-diff <id>`, `proposal-archive`, `git-branches`, `peer-list`, `peer-scan`, `pin-list`.
  - **LLM-bound** (regular slash templates): `session-tell <id> <text>`, `session-abort <id>`, `session-abort-all`, `session-kill <id>`, `session-rename <id> <name>`, `session-hide <id>`, `session-unhide <id>`, `session-spawn [cwd]`, `session-resume <id>`, `session-fork <id>`, `session-model <id> <p/m>`, `session-thinking <id> <level>`, `proposal-attach <id> <change>`, `proposal-detach <id>`, `flow-abort <id>`, `flow-auto <id>`, `git-init [cwd]`, `git-stash-pop [cwd>`, `server-tunnel-on`, `server-tunnel-off`.
- **NEW**: A discoverability footer rendered by the client when an `executable: bash` command runs: a small "ℹ ran locally — LLM not invoked" line below the output, so users learn the cost story.
- **MODIFIED**: `prompt-expander.ts` — `readTemplate()` returns `{ frontmatter, body }` instead of a single string. Parses YAML frontmatter into a typed object (`{ executable?: "bash"; excludeFromContext?: boolean; description?: string }`). New export `loadPromptTemplate(text, cwd, pi)` returns a discriminated union `{ kind: "llm"; text } | { kind: "exec"; body, excludeFromContext, argsString }`. Existing `expandPromptTemplateFromDisk(...)` keeps its current signature for backwards compat — it now delegates to `loadPromptTemplate` and returns the LLM-text shape only.
- **MODIFIED**: `command-handler.ts` — `parseSendPrompt(text)` peeks at the resolved template via the new `loadPromptTemplate` helper. When the template is `kind: "exec"`, it returns `{ type: "slash-exec", ... }`. The `handle()` switch adds a new arm dispatching to `handleBashCommand`.
- **NOT INTRODUCED**: A new prompt-expander subdirectory scan. Today's expander reads `.pi/prompts/*.md` flat plus `.pi/skills/*/SKILL.md`. The new prompts live flat in `~/.pi/prompts/` with the `dashboard-` prefix. (Per-skill subdirs deferred — see design.md.)
- **NOT INTRODUCED**: New event types. Exec-mode commands reuse the existing `bash_output` event for chat rendering; the "ran locally" footer is a client-side decoration on `bash_output` events whose source is a slash-exec template (signalled via a new optional `data.source: "slash-exec"` field on `bash_output`, additive and backward-compatible).
- **NOT INTRODUCED**: A new bash-execution code path. All exec-mode templates go through the existing `handleBashCommand` function in `command-handler.ts`.
- **NOT INTRODUCED**: Server-side endpoints. Every command in the set hits an existing endpoint via `~/.pi/skills/pi-dashboard/scripts/dashboard-api.sh` (the helper that ships with the existing skill).
- **NOT INTRODUCED**: A "fan-out helper" or "all sessions" command suite. Bulk operations (`session-abort-all`) are LLM-bound because they require judgment ("abort which? all streaming, or just the ones in cwd?").

## Capabilities

### New Capabilities

- `dashboard-slash-commands`: the `/dashboard:*` command namespace, the naming grammar, the initial command set, and the discoverability contract (footer rendering, autocomplete grouping).
- `prompt-template-executable-mode`: the `executable: bash` frontmatter directive, the new `ParsedPrompt` variant, and the dispatch contract that runs body via bash and skips the LLM.

### Modified Capabilities

None. The existing slash-command pipeline (template → LLM as user message) continues to work for every template that does not carry the `executable` frontmatter. Backward compat is preserved for every template currently on disk.

## Impact

- **MODIFIED files**:
  - `packages/extension/src/prompt-expander.ts` — frontmatter parser + new exported `loadPromptTemplate(...)`.
  - `packages/extension/src/command-handler.ts` — new `ParsedPrompt` variant + dispatch arm.
  - `packages/shared/src/protocol.ts` — `bash_output` event payload gets optional `source: "slash-exec"` field.
  - `packages/client/src/components/...` — chat renderer for `bash_output` adds the "ℹ ran locally" footer when `data.source === "slash-exec"`.
- **NEW files (in repo)**:
  - `~/.pi/prompts/dashboard-*.md` (~30 templates) — but these ship as part of the existing `.pi/skills/pi-dashboard/` skill, so they live at `.pi/skills/pi-dashboard/commands/` (a new subdir) and the SKILL.md is updated to advertise them. The expander's reading of `pi.getCommands()` (already in place) picks them up via skills routing.
  - `.pi/skills/pi-dashboard/commands/dashboard-server-health.md`, ..., `.pi/skills/pi-dashboard/commands/dashboard-pin-list.md`.
  - `.pi/skills/pi-dashboard/references/slash-commands.md` — reference doc listing every command, args, what it does, whether it's LLM-free.
- **MODIFIED**: `.pi/skills/pi-dashboard/SKILL.md` — adds a "Slash Commands" section pointing at the new commands directory.
- **MODIFIED**: `AGENTS.md` Key Files table — adds the prompt-expander frontmatter contract, the new `slash-exec` ParsedPrompt variant, and the `bash_output.data.source` field.
- **MODIFIED**: `README.md` — adds a "Slash Commands" section under "Using the Dashboard from a pi Session".
- **MODIFIED**: `docs/architecture.md` — adds a sub-section under the bridge-extension flow describing the four pipelines (now five with `slash-exec`).
- **Backward compatibility**: Every existing `~/.pi/prompts/*.md` and every `.pi/skills/*/SKILL.md` continues to work unchanged. Templates without `executable` frontmatter route to the LLM exactly as before. The change is purely additive at the parse/dispatch layer.

## References

- Existing helper script and skill: `.pi/skills/pi-dashboard/SKILL.md`, `.pi/skills/pi-dashboard/scripts/dashboard-api.sh`, `.pi/skills/pi-dashboard/references/api-reference.md`.
- Slash command pipeline today: `packages/extension/src/prompt-expander.ts`, `packages/extension/src/command-handler.ts`.
- The four existing pipelines:
  - `!cmd`  — `parseSendPrompt` → `{ type: "bash", excludeFromContext: false }` → `handleBashCommand` + send to LLM.
  - `!!cmd` — `parseSendPrompt` → `{ type: "bash", excludeFromContext: true }`  → `handleBashCommand` only.
  - `/cmd`  — `parseSendPrompt` → `{ type: "slash" }` → expand template → `pi.sendUserMessage` → LLM.
  - Hard-coded (`/reload`, `/new`, `/model`, `/compact`, `/quit`) — direct dispatch, `command_feedback` event, no LLM.
- The fifth pipeline this proposal adds: `/cmd` whose template carries `executable: bash` → `parseSendPrompt` → `{ type: "slash-exec" }` → `handleBashCommand` only, no LLM.
