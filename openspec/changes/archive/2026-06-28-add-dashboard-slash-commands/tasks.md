## 1. Frontmatter parser + template loader

- [x] 1.1 Add a typed `PromptFrontmatter` interface to `packages/extension/src/prompt-expander.ts`: `{ executable?: "bash"; excludeFromContext?: boolean; description?: string }`.
- [x] 1.2 Add a hand-rolled YAML-lite parser (line-oriented `key: value`, no nesting) that returns a `PromptFrontmatter` from the frontmatter block. Unknown keys ignored (forward compat). Malformed values default to undefined.
- [x] 1.3 Refactor `readTemplate(filePath)` to return `{ frontmatter: PromptFrontmatter; body: string }` instead of a single string. Existing call site that wants the body only still works (destructure `.body`).
- [x] 1.4 Add new exported helper `loadPromptTemplate(text, cwd, pi)` returning a discriminated union: `{ kind: "llm"; text: string } | { kind: "exec"; body: string; excludeFromContext: boolean; argsString: string } | null` (null when no template matched).
- [x] 1.5 Keep `expandPromptTemplateFromDisk(text, cwd, pi)` exported with its current signature for backward compat; refactor its body to delegate to `loadPromptTemplate` and return only the LLM-text shape (`null` falls back to original `text`).
- [x] 1.6 Tests in `packages/extension/src/__tests__/prompt-expander.test.ts`:
  - frontmatter parse: every valid combination of the three keys.
  - malformed YAML (unclosed `---`, key without colon, value with colon in it) → falls back gracefully.
  - `executable: bash` resolves to `kind: "exec"`.
  - `executable: node` (unsupported value) resolves to `kind: "llm"` (graceful degrade).
  - Existing tests for arg-substitution semantics still pass for `kind: "llm"`.

## 2. Command-handler dispatch

PRECONDITION SATISFIED: `fix-extension-slash-commands-in-dashboard` is archived (2026-05-09) and extracted `packages/extension/src/slash-dispatch.ts`. The exec branch lands AFTER the `tryDispatchExtensionCommand(...)` call in the same call sites.

DESIGN REFINEMENT (during impl): instead of a vestigial `ParsedPrompt` `slash-exec` variant threaded through `parseSendPrompt` (which is sync and has no cwd/pi to resolve templates), the exec branch is a shared exported helper `tryExecSlashTemplate(pi, text, cwd, sessionId, eventSink)` in `command-handler.ts` that mirrors `tryDispatchExtensionCommand`'s shape. Both call sites call it after extension dispatch. Cleaner, fully unit-testable, no half-used union variant.

- [x] 2.1 ~~Add `ParsedPrompt` variant~~ → Added exported `tryExecSlashTemplate(...)` helper in `command-handler.ts` (resolves via `loadPromptTemplate`, runs `handleBashCommand` when `kind: "exec"`, returns true; false otherwise).
- [x] 2.2 ~~parseSendPrompt peek~~ → Template resolution + exec classification lives in `loadPromptTemplate` (§1) called by `tryExecSlashTemplate`. `parseSendPrompt` unchanged (still returns `{ type: "slash" }`); exec runs AFTER extension dispatch in both call sites per spec precedence.
- [x] 2.3 `tryExecSlashTemplate` calls `handleBashCommand` verbatim (no duplicated execution code) and is invoked in the command-handler non-bridge slash fallback after `tryDispatchExtensionCommand`.
- [x] 2.3a Mirrored the exec branch in `bridge.ts::sessionPrompt` immediately AFTER `if (handled) return;` and BEFORE `expandPromptTemplateFromDisk`. Same shared helper, not grafted into `tryDispatchExtensionCommand`.
- [x] 2.4 `handleBashCommand` accepts `execOpts?: { args?; env?; source? }`; sets `data.source` on the `bash_output` event only when present.
- [x] 2.5 Invocation is `pi.exec(resolved-bash, ["-c", script, "--", ...args])` (bash, resolved via tool registry like `!`/`!!`, not literal `sh`) so `$1`, `$2`, … bind. `args = argsString.trim().split(/\s+/).filter(Boolean)`.
- [x] 2.6 `buildDashboardExecEnv()` reads port from `~/.pi/dashboard/config.json` (default 8000). Injected by prepending `export PI_DASHBOARD_PORT=…; export PI_DASHBOARD_BASE=…` to the body (ExecOptions has no `env` field).
- [x] 2.7 Tests in `packages/extension/src/__tests__/command-handler.test.ts`:
  - exec-mode template → `bash_output` event with `data.source === "slash-exec"` and `excludeFromContext: true`.
  - exec-mode template with `excludeFromContext: false` → `bash_output` AND `pi.sendUserMessage` called (mirrors `!` semantics).
  - LLM-mode slash template → no `bash_output`, sends user message (preserves existing behaviour).
  - Args with multiple tokens are positional: `/dashboard:session-info abc 123` runs body with `$1=abc`, `$2=123`.
  - `PI_DASHBOARD_PORT` env is set on the spawned process.

## 3. Verify command discovery for nested skill commands

- [x] 3.1 Conclusion: `pi.getCommands()` nested-`commands/` surfacing is pi-version-dependent and not guaranteed. Chose the deterministic local-scan path (3.2) rather than depending on it.
- [x] 3.2 Extended `findPromptTemplates`/`scanDir` with `scanCommandsSubdir(<skill>/commands)` — descends exactly one level, keys each `.md` by basename, does not clobber top-level names. Test: `resolves a skill-bundled command from <skill>/commands/*.md`.
- [x] 3.3 N/A — local scan keys by basename (the existing `:`↔`-` alias resolution in `candidateNames` handles `/dashboard:server-health` → `dashboard-server-health`). pi.getCommands() fallback still consulted last.
- [x] 3.4 Documented the 4-step resolution path in `findPromptTemplates` JSDoc.

## 4. Protocol update

- [x] 4.1 Extended `BashOutputData` in `packages/shared/src/types.ts` with optional `source?: "slash-exec"` + change-citing comment.
- [x] 4.2 Confirmed `bash_output` does not flow through `browser-protocol.ts` — no change needed there.
- [x] 4.3 Additive: `source` is only set for exec templates (`execOpts?.source` guard); `!` / `!!` omit it. Old clients ignore the field (no footer).

## 5. Client-side footer rendering

- [x] 5.1 Component is `packages/client/src/components/BashOutputCard.tsx`, fed by `event-reducer.ts` (`bash_output` case) → `args` → `ChatView.tsx`.
- [x] 5.2 `BashOutputCard` renders the footer `ℹ ran locally — LLM not invoked` (muted `text-tertiary`, top-bordered) when `source === "slash-exec"`. `event-reducer` threads `data.source` into `args.source`; `ChatView` passes it through.
- [x] 5.3 Footer guarded by `source === "slash-exec"`; `!`/`!!` omit `source` so no footer.
- [x] 5.4 Test `packages/client/src/components/__tests__/BashOutputCard.test.tsx` asserts footer present for slash-exec, absent for `!` and `!!`.
- [x] 5.5 Verified: `BashOutputCard.test.tsx` asserts footer present for `source:"slash-exec"`, absent for `!`/`!!`; live container confirmed the `source` flag round-trips end-to-end (§10).

## 6. Skill scaffolding (commands directory)

- [x] 6.1 Create the directory `.pi/skills/pi-dashboard/commands/`.
- [x] 6.2 Add a top-level `.pi/skills/pi-dashboard/commands/README.md` describing the dir's purpose, the frontmatter convention, and the `dashboard-` prefix rule.
- [x] 6.3 Update `.pi/skills/pi-dashboard/SKILL.md` to add a "Slash Commands" section listing the namespace, citing the commands dir, and showing one LLM-free and one LLM-bound example.
- [x] 6.4 Add `.pi/skills/pi-dashboard/references/slash-commands.md` — a single-page reference of every command, args, what it does, whether it's LLM-free.
- [x] 6.5 If §3 concluded the expander needs the `commands/` subdir scan, document it in the skill's README.

## 7. LLM-free commands (`executable: bash`)

Each file ships at `.pi/skills/pi-dashboard/commands/dashboard-<name>.md` with `executable: bash` frontmatter. IMPL NOTE: bodies use direct `curl "$PI_DASHBOARD_BASE/..." | jq` (the injected env var) instead of `dashboard-api.sh` — the exec body cannot reliably reference the helper's on-disk path, and the env-var requirement explicitly enables `curl "$PI_DASHBOARD_BASE/..."` without setup. 13 LLM-free files created.

- [x] 7.1 `dashboard-server-health.md` — GET /api/health → formatted line.
- [x] 7.2 `dashboard-server-config.md` — GET /api/config → pretty JSON (redacted secrets).
- [x] 7.3 `dashboard-server-tunnel-status.md` — GET /api/tunnel-status → status + URL.
- [x] 7.4 `dashboard-session-list.md` — GET /api/sessions → table (id-prefix | status | name | cwd).
- [x] 7.5 `dashboard-session-list-active.md` — GET /api/sessions, jq filter status in {streaming, active}, table.
- [x] 7.6 `dashboard-session-list-here.md` — GET /api/sessions, jq filter cwd === $PWD, table.
- [x] 7.7 `dashboard-session-info.md` — accepts `<id-prefix>`. GET /api/sessions, jq find id starts-with arg, render every field as a labelled line.
- [x] 7.8 `dashboard-session-diff.md` — accepts `<id>`. GET /api/session-diff, render file list + diff blocks.
- [x] 7.9 `dashboard-proposal-archive.md` — GET /api/openspec-archive?cwd=$PWD → grouped table by date.
- [x] 7.10 `dashboard-git-branches.md` — GET /api/git/branches?cwd=$PWD → branch list with current marker.
- [x] 7.11 `dashboard-peer-list.md` — GET /api/known-servers → list with labels.
- [x] 7.12 `dashboard-peer-scan.md` — POST /api/discover-servers → list with labels.
- [x] 7.13 `dashboard-pin-list.md` — GET /api/pinned-dirs → list.
- [x] 7.14 Validated: every `executable: bash` body passes `bash -n`; end-to-end run against a mock dashboard (server-health, session-list, session-list-active, session-info, usage/exit-2 path) produces correct output with injected `PI_DASHBOARD_BASE`. Live-dashboard footer check deferred to §10 (no server on 8000 during impl).

## 8. LLM-bound commands (regular slash templates)

Each file ships at `.pi/skills/pi-dashboard/commands/dashboard-<name>.md` WITHOUT `executable` frontmatter. Body is markdown instructing the LLM what to do (shared preamble: discover BASE from config, resolve id-prefix via GET /api/sessions; args append after the body). 20 LLM-bound files created.

- [x] 8.1 `dashboard-session-tell.md` — instruct LLM to resolve `<id-prefix>`, POST /api/session/:id/prompt with `<text>` arg.
- [x] 8.2 `dashboard-session-abort.md` — resolve id-prefix, POST abort.
- [x] 8.3 `dashboard-session-abort-all.md` — list active, ask LLM to confirm scope (all, or a filter), then iterate.
- [x] 8.4 `dashboard-session-kill.md` — resolve id-prefix, POST shutdown. Template warns about destructiveness.
- [x] 8.5 `dashboard-session-rename.md` — resolve id, POST rename with `<name>`.
- [x] 8.6 `dashboard-session-hide.md` / `dashboard-session-unhide.md` — resolve id, POST hide/unhide.
- [x] 8.7 `dashboard-session-spawn.md` — POST /api/session/spawn with `<cwd>` (default $PWD).
- [x] 8.8 `dashboard-session-resume.md` / `dashboard-session-fork.md` — resolve id, POST resume with `mode=continue`/`fork`.
- [x] 8.9 `dashboard-session-model.md` — resolve id, POST model with `<provider>/<modelId>` arg.
- [x] 8.10 `dashboard-session-thinking.md` — resolve id, POST thinking-level with `<level>`.
- [x] 8.11 `dashboard-proposal-attach.md` / `dashboard-proposal-detach.md` — resolve id, POST attach/detach.
- [x] 8.12 `dashboard-flow-abort.md` / `dashboard-flow-auto.md` — resolve id, POST flow-control with action.
- [x] 8.13 `dashboard-git-init.md` / `dashboard-git-stash-pop.md` — POST with cwd (default $PWD).
- [x] 8.14 `dashboard-server-tunnel-on.md` / `dashboard-server-tunnel-off.md` — POST tunnel-connect/disconnect.

## 9. Documentation

- [x] 9.1 AGENTS.md no longer holds a per-file index (moved to `docs/file-index-<area>.md` splits per Documentation Update Protocol). Rows added/updated via subagent (caveman style): `prompt-expander.ts`, `command-handler.ts`, `bridge.ts` + new test rows in `file-index-extension.md`; `BashOutputData.source` in `file-index-shared.md`; `BashOutputCard.tsx`/`ChatView.tsx`/`event-reducer.ts` + test in `file-index-client.md`; new `.pi/skills/pi-dashboard/commands/` row in `file-index-skills-misc.md`. (Design changed: shared `tryExecSlashTemplate` helper, not a `slash-exec` ParsedPrompt variant — see §2.)
- [x] 9.2 README.md: added "Slash commands (`/dashboard:*`) from a pi session" subsection after Session spawning (LLM-free vs LLM-bound examples + reference link).
- [x] 9.3 docs/architecture.md Command Flow step 4: added the `executable: bash` slash pipeline bullet (the five pipelines now enumerated there: `!!`, `!`, `/compact`, `/<command>` LLM, `/<command>` exec). Bullet covers the new pipeline; existing mermaid at line ~1319 unchanged.
- [x] 9.4 `openspec validate add-dashboard-slash-commands --strict` passes (`Change ... is valid`).

## 10. Manual verification

LIVE-VERIFIED via the Docker test harness (no host deploy needed). Built the
image from this worktree (`docker/test-up.sh --build`), spawned a real tmux
session with cwd `/home/pi` (no skill on disk — exercises the registry-harvest
resolution), and drove prompts over the browser `/ws`, capturing `bash_output`
events. Results:
  - `/dashboard:server-health` → `bash_output { source: "slash-exec", exitCode: 0,
    output: "ok=true  pid=63  uptime=69s" }` — exec ran, curl+jq hit the
    in-container dashboard, source flag set, NO LLM turn. PASS.
  - `!echo hi-from-bang` → `bash_output` with NO `source` field. PASS.
  - This caught + fixed a real port-resolution bug (§11 below).
Host Playwright run blocked only by env (cdn.playwright.dev unreachable — no
chromium binary; worktree has no node_modules). The committed spec
`tests/e2e/dashboard-slash.spec.ts` runs in CI where browsers are present.

- [x] 10.1 `/dashboard:server-health` runs locally, no LLM — LIVE: container `bash_output {source:"slash-exec", output:"ok=true ..."}`, no LLM turn.
- [x] 10.2 `/dashboard:session-list` (list/no-LLM) — covered by the same exec pipeline proof (10.1) + `tryExecSlashTemplate` asserts no `sendUserMessage`.
- [x] 10.3 `/dashboard:session-info <id-prefix>` — mock-server e2e renders all fields + usage/exit-2 path (prompt body identical pattern).
- [x] 10.4 `/dashboard:session-tell` invokes LLM — `loadPromptTemplate` returns `kind:"llm"` for no-`executable` templates (prompt-expander test).
- [x] 10.5 regular `/skill:*` still LLM-bound — prompt-expander + bridge-slash-routing tests pass (no regression).
- [x] 10.6 `!echo` / `!!echo` no footer — LIVE: container `!echo hi-from-bang` → `bash_output` with NO `source`; `BashOutputCard.test.tsx` (no footer without source).

## 11. Post-implementation hardening (found via Docker live verification)

- [x] 11.1 Ship blocker: commands existed only in repo-root `.pi/skills/pi-dashboard/` (dev copy). Copied 33 templates + README + `references/slash-commands.md` into `packages/extension/.pi/skills/pi-dashboard/` (the copy declared in `package.json` `pi.skills`+`files`, baked into the npm tarball + Docker image). Mirrored the SKILL.md "Slash Commands" section. Test: `dashboard-commands-shipped.test.ts`.
- [x] 11.2 cwd-independent resolution: real sessions run with cwd = user project (NOT the extension install dir), and `pi.getCommands()` surfaces the skill dir, not nested `commands/*.md`. Added `addSkillCommandsFromRegistry(pi, templates)` — harvests each registry skill's sibling `commands/*.md` via `sourceInfo.path`. So `/dashboard:*` resolves from any cwd. Unit test: "resolves a bundled command via pi.getCommands() when cwd lacks the skill". LIVE-confirmed (cwd `/home/pi`).
- [x] 11.3 Port-resolution bug (caught live): `buildDashboardExecEnv` read only `config.json` `port`, which the Docker harness omits → defaulted to 8000 while the server ran on 18000 → empty curl output. Fixed `resolveDashboardPort()` precedence: `PI_DASHBOARD_PORT`/`DASHBOARD_PORT` env (inherited by spawned sessions) → `config.json` port → 8000. Unit tests cover all three tiers. LIVE-confirmed (`ok=true` after rebuild).
- [x] 11.4 E2E spec `tests/e2e/dashboard-slash.spec.ts`: spawn session → `/dashboard:server-health` asserts footer + `ok=true`; `!echo` asserts no footer. Runs in CI (host browser blocked locally by CDN).
