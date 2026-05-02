## 1. Frontmatter parser + template loader

- [ ] 1.1 Add a typed `PromptFrontmatter` interface to `packages/extension/src/prompt-expander.ts`: `{ executable?: "bash"; excludeFromContext?: boolean; description?: string }`.
- [ ] 1.2 Add a hand-rolled YAML-lite parser (line-oriented `key: value`, no nesting) that returns a `PromptFrontmatter` from the frontmatter block. Unknown keys ignored (forward compat). Malformed values default to undefined.
- [ ] 1.3 Refactor `readTemplate(filePath)` to return `{ frontmatter: PromptFrontmatter; body: string }` instead of a single string. Existing call site that wants the body only still works (destructure `.body`).
- [ ] 1.4 Add new exported helper `loadPromptTemplate(text, cwd, pi)` returning a discriminated union: `{ kind: "llm"; text: string } | { kind: "exec"; body: string; excludeFromContext: boolean; argsString: string } | null` (null when no template matched).
- [ ] 1.5 Keep `expandPromptTemplateFromDisk(text, cwd, pi)` exported with its current signature for backward compat; refactor its body to delegate to `loadPromptTemplate` and return only the LLM-text shape (`null` falls back to original `text`).
- [ ] 1.6 Tests in `packages/extension/src/__tests__/prompt-expander.test.ts`:
  - frontmatter parse: every valid combination of the three keys.
  - malformed YAML (unclosed `---`, key without colon, value with colon in it) → falls back gracefully.
  - `executable: bash` resolves to `kind: "exec"`.
  - `executable: node` (unsupported value) resolves to `kind: "llm"` (graceful degrade).
  - Existing tests for arg-substitution semantics still pass for `kind: "llm"`.

## 2. Command-handler dispatch

- [ ] 2.1 Add new variant to the `ParsedPrompt` union in `packages/extension/src/command-handler.ts`: `{ type: "slash-exec"; command: string; excludeFromContext: boolean; argsString: string }`.
- [ ] 2.2 Modify `parseSendPrompt(text)` so the existing `// 6. Check / prefix (generic slash command)` arm peeks at the resolved template via `loadPromptTemplate`. When the template is `kind: "exec"`, return the new `slash-exec` variant; otherwise return `{ type: "slash" }` as before.
- [ ] 2.3 In the `handle()` switch in `createCommandHandler`, add an arm for `parsed.type === "slash-exec"` that calls `handleBashCommand(pi, sessionId, parsed.command, parsed.excludeFromContext, options?.eventSink)` and returns. Reuse `handleBashCommand` verbatim — no duplicated execution code.
- [ ] 2.4 Modify `handleBashCommand` to accept an optional `source: "slash-exec"` parameter and include it in the `bash_output` event's `data` payload.
- [ ] 2.5 The exec-mode dispatcher MUST construct the bash invocation as `sh -c "<body>" -- <argsString-tokens>` so positional `$1`, `$2`, ... work in the body. Implement by calling `pi.exec("sh", ["-c", body, "--", ...args])` where `args = argsString.trim().split(/\s+/).filter(Boolean)`.
- [ ] 2.6 Inject env vars `PI_DASHBOARD_PORT` (from `~/.pi/dashboard/config.json`, default 8000) and `PI_DASHBOARD_BASE` (`http://localhost:$PORT`) into the exec environment so templates don't have to re-derive them.
- [ ] 2.7 Tests in `packages/extension/src/__tests__/command-handler.test.ts`:
  - exec-mode template → `bash_output` event with `data.source === "slash-exec"` and `excludeFromContext: true`.
  - exec-mode template with `excludeFromContext: false` → `bash_output` AND `pi.sendUserMessage` called (mirrors `!` semantics).
  - LLM-mode slash template → no `bash_output`, sends user message (preserves existing behaviour).
  - Args with multiple tokens are positional: `/dashboard:session-info abc 123` runs body with `$1=abc`, `$2=123`.
  - `PI_DASHBOARD_PORT` env is set on the spawned process.

## 3. Verify command discovery for nested skill commands

- [ ] 3.1 Investigate whether `pi.getCommands()` (used by the expander as a fallback in `prompt-expander.ts:90-97`) surfaces `.md` files in a skill's `commands/` subdir, or only the skill's top-level `SKILL.md`.
- [ ] 3.2 If nested commands are NOT surfaced by `pi.getCommands()`, extend the expander's `findPromptTemplates(cwd)` to also scan `<cwd>/.pi/skills/*/commands/*.md` (descend exactly one level into `commands/`). Add tests covering the scan.
- [ ] 3.3 If `pi.getCommands()` surfaces them but uses a different name shape (e.g. `skill:name/command`), update the expander's fallback resolver to recognise the shape.
- [ ] 3.4 Document the resolution path in `packages/extension/src/prompt-expander.ts` JSDoc.

## 4. Protocol update

- [ ] 4.1 In `packages/shared/src/protocol.ts`, extend the `bash_output` event's `data` shape to include optional `source?: "slash-exec"`. Comment in proximity citing this change name.
- [ ] 4.2 Verify the protocol change is also reflected in `packages/shared/src/browser-protocol.ts` if `bash_output` flows through there. If yes, add the field to that union too.
- [ ] 4.3 Confirm the change is purely additive: old bridges/clients without the field render `bash_output` events normally (no footer); new bridges/clients render the footer when the field is `"slash-exec"`.

## 5. Client-side footer rendering

- [ ] 5.1 Locate the React component that renders `bash_output` chat messages (likely under `packages/client/src/components/`). Identify the existing rendering shape.
- [ ] 5.2 Add conditional rendering: when the `bash_output` event's `data.source === "slash-exec"`, render a footer beneath the output: `ℹ ran locally — LLM not invoked` (small text, muted color, single line).
- [ ] 5.3 Do not add the footer for `bash_output` events from `!`/`!!` (no `data.source` field, or any other value).
- [ ] 5.4 Component-level test: render a `bash_output` event with and without `data.source: "slash-exec"`, assert footer presence/absence.
- [ ] 5.5 Verify in the running dashboard: type `!echo hi` → no footer. Type `/dashboard:server-health` → footer present.

## 6. Skill scaffolding (commands directory)

- [ ] 6.1 Create the directory `.pi/skills/pi-dashboard/commands/`.
- [ ] 6.2 Add a top-level `.pi/skills/pi-dashboard/commands/README.md` describing the dir's purpose, the frontmatter convention, and the `dashboard-` prefix rule.
- [ ] 6.3 Update `.pi/skills/pi-dashboard/SKILL.md` to add a "Slash Commands" section listing the namespace, citing the commands dir, and showing one LLM-free and one LLM-bound example.
- [ ] 6.4 Add `.pi/skills/pi-dashboard/references/slash-commands.md` — a single-page reference of every command, args, what it does, whether it's LLM-free.
- [ ] 6.5 If §3 concluded the expander needs the `commands/` subdir scan, document it in the skill's README.

## 7. LLM-free commands (`executable: bash`)

Each file ships at `.pi/skills/pi-dashboard/commands/dashboard-<name>.md` with `executable: bash` frontmatter. Body uses `dashboard-api.sh` and `jq`.

- [ ] 7.1 `dashboard-server-health.md` — GET /api/health → formatted line.
- [ ] 7.2 `dashboard-server-config.md` — GET /api/config → pretty JSON (redacted secrets).
- [ ] 7.3 `dashboard-server-tunnel-status.md` — GET /api/tunnel-status → status + URL.
- [ ] 7.4 `dashboard-session-list.md` — GET /api/sessions → table (id-prefix | status | name | cwd).
- [ ] 7.5 `dashboard-session-list-active.md` — GET /api/sessions, jq filter status in {streaming, active}, table.
- [ ] 7.6 `dashboard-session-list-here.md` — GET /api/sessions, jq filter cwd === $PWD, table.
- [ ] 7.7 `dashboard-session-info.md` — accepts `<id-prefix>`. GET /api/sessions, jq find id starts-with arg, render every field as a labelled line.
- [ ] 7.8 `dashboard-session-diff.md` — accepts `<id>`. GET /api/session-diff, render file list + diff blocks.
- [ ] 7.9 `dashboard-proposal-archive.md` — GET /api/openspec-archive?cwd=$PWD → grouped table by date.
- [ ] 7.10 `dashboard-git-branches.md` — GET /api/git/branches?cwd=$PWD → branch list with current marker.
- [ ] 7.11 `dashboard-peer-list.md` — GET /api/known-servers → list with labels.
- [ ] 7.12 `dashboard-peer-scan.md` — POST /api/discover-servers → list with labels.
- [ ] 7.13 `dashboard-pin-list.md` — GET /api/pinned-dirs → list.
- [ ] 7.14 Smoke test each command in a running dashboard: invocation runs without LLM, output renders correctly, footer appears.

## 8. LLM-bound commands (regular slash templates)

Each file ships at `.pi/skills/pi-dashboard/commands/dashboard-<name>.md` WITHOUT `executable` frontmatter. Body is markdown instructing the LLM what to do.

- [ ] 8.1 `dashboard-session-tell.md` — instruct LLM to resolve `<id-prefix>`, POST /api/session/:id/prompt with `<text>` arg.
- [ ] 8.2 `dashboard-session-abort.md` — resolve id-prefix, POST abort.
- [ ] 8.3 `dashboard-session-abort-all.md` — list active, ask LLM to confirm scope (all, or a filter), then iterate.
- [ ] 8.4 `dashboard-session-kill.md` — resolve id-prefix, POST shutdown. Template warns about destructiveness.
- [ ] 8.5 `dashboard-session-rename.md` — resolve id, POST rename with `<name>`.
- [ ] 8.6 `dashboard-session-hide.md` / `dashboard-session-unhide.md` — resolve id, POST hide/unhide.
- [ ] 8.7 `dashboard-session-spawn.md` — POST /api/session/spawn with `<cwd>` (default $PWD).
- [ ] 8.8 `dashboard-session-resume.md` / `dashboard-session-fork.md` — resolve id, POST resume with `mode=continue`/`fork`.
- [ ] 8.9 `dashboard-session-model.md` — resolve id, POST model with `<provider>/<modelId>` arg.
- [ ] 8.10 `dashboard-session-thinking.md` — resolve id, POST thinking-level with `<level>`.
- [ ] 8.11 `dashboard-proposal-attach.md` / `dashboard-proposal-detach.md` — resolve id, POST attach/detach.
- [ ] 8.12 `dashboard-flow-abort.md` / `dashboard-flow-auto.md` — resolve id, POST flow-control with action.
- [ ] 8.13 `dashboard-git-init.md` / `dashboard-git-stash-pop.md` — POST with cwd (default $PWD).
- [ ] 8.14 `dashboard-server-tunnel-on.md` / `dashboard-server-tunnel-off.md` — POST tunnel-connect/disconnect.

## 9. Documentation

- [ ] 9.1 Update `AGENTS.md` Key Files table:
  - `packages/extension/src/prompt-expander.ts` row — describe the new frontmatter contract, `loadPromptTemplate` return shape, and `executable: bash` semantics. Cite this change.
  - `packages/extension/src/command-handler.ts` row — describe the new `slash-exec` ParsedPrompt variant and dispatch. Cite this change.
  - `packages/shared/src/protocol.ts` row — describe the new `bash_output.data.source: "slash-exec"` field. Cite this change.
  - Add a new row for `.pi/skills/pi-dashboard/commands/` directory.
- [ ] 9.2 Update `README.md` to add a "Slash Commands" section under the dashboard-from-pi-session usage area.
- [ ] 9.3 Update `docs/architecture.md` bridge-extension section: list the five pipelines (now including slash-exec) with the mermaid diagram from this change's design.md.
- [ ] 9.4 Verify `openspec validate add-dashboard-slash-commands --strict` passes.

## 10. Manual verification

- [ ] 10.1 In a running dashboard, type `/dashboard:server-health` — verify: chat shows curl output, footer appears, no LLM activity in the session timeline.
- [ ] 10.2 Type `/dashboard:session-list` — verify table renders, no LLM activity, no token cost in stats.
- [ ] 10.3 Type `/dashboard:session-info <id-prefix>` — verify all fields render.
- [ ] 10.4 Type `/dashboard:session-tell <id> "hello from another session"` — verify LLM is invoked, the target session receives the prompt.
- [ ] 10.5 Type a regular `/skill:something` slash command — verify the existing LLM-bound flow still works (regression check).
- [ ] 10.6 Type `!echo hi` and `!!echo bye` — verify both still work and neither shows the slash-exec footer (regression check).
