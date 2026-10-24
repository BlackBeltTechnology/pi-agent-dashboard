# Tasks

## 1. Spikes: verify SDK assumptions (design Risks)

- [ ] 1.1 Spike: `resources_discover` returning absolute `skillPaths` outside the package root makes those skills appear in a session's skill list. Verify: a scratch extension's skill shows in the system prompt skill list; outcome recorded in design.md D2 (keep, or switch to the documented fallback).
- [ ] 1.2 Spike: a TUI-typed `/skill:<name>` reaches an extension `input` handler before pi injects the body. Verify: scratch extension logs the raw `/skill:` text; outcome recorded in design.md D2.
- [ ] 1.3 Spike: `grep`, `find` and `ls` are available as tools in a `pi-dashboard-subagents` child session. Verify: spawn a child with `tools: [grep, find, ls]` and list its active tools; outcome recorded in design.md D4 (1:1 mapping, or map to `bash`).
- [ ] 1.4 Spike: every extension's `session_start` handler completes before the first `resources_discover` handler runs. Verify: two scratch extensions log timestamps; outcome recorded in design.md D3 (keep the election point, or use the fallback).
- [ ] 1.5 Spike: a bridge `pi.events` announcement emitted just before `sendUserMessage` can be matched to the following `input` event by text within the same tick. Verify: scratch listener pairs 100 announced prompts with 0 mismatches; outcome recorded in design.md D7.

## 2. `packages/claude-compat` scaffold and shared tables

- [ ] 2.1 Create workspace package `packages/claude-compat`: pi package manifest, single-file ESM build target, `tsconfig`, `vitest.config.ts`, `AGENTS.md`, README. Verify: `pnpm install` succeeds and `npm test -- packages/claude-compat` runs.
- [ ] 2.2 Implement the tool alias table, including scoped-form rejection and the reverse matcher, and the model→role map (design D4), as the single exported source the server also imports. Verify: unit tests cover every alias row and the reverse lookup.
- [ ] 2.3 Implement `registerClaudePlugin(pi, {overlayRoot})` with a per-session-id registry: record in `session_start`, elect in `resources_discover`, drop on `session_shutdown` (design D3). Verify: covered by the group 6 tests.

## 3. Server: marketplace sources (spec `claude-marketplace-sources`)

- [ ] 3.1 Implement the marketplace registry (`~/.pi/claude-plugins/marketplaces.json`), the manifest parser and the catalogue model. Verify: the 3.x tests below pass.
- [ ] 3.2 Implement the source resolver:
  - relative path, `./`, `url`, `git-subdir`, `github`;
  - branch/tag vs 40-hex SHA refs;
  - `execFile` argv only, 120 s timeout, partial-directory cleanup.

  Verify: the 3.x tests below pass.
- [ ] 3.3 Implement component resolution (defaults ∪ `plugin.json` ∪ inline entry; `strict:false` authoritative) and the realpath containment helper. Verify: the 3.x tests below pass.
- [ ] 3.4 Implement discovery and adoption of `~/.claude/plugins`, plus a write guard rejecting any path under it. Verify: the 3.x tests below pass.
- [ ] 3.5 Add REST routes `/api/claude-marketplaces/*` (list, add, refresh, remove, discover, catalogue, inspect) with structured logs (design D13). Verify: route tests for success and error shapes, plus log-line assertions.
- [ ] 3.6 L1 test (test-plan #E1). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: a dir with a valid `marketplace.json` (`name: fx`, 9 plugins).
  - Trigger: register.
  - Observable: registry lists `fx` with 9 entries, and a re-instantiated registry still lists 9.
- [ ] 3.7 L1 test (test-plan #E2). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: dirs with no manifest, invalid JSON, and no `plugins` array.
  - Trigger: register each.
  - Observable: each is rejected naming the file or parse reason, and `marketplaces.json` is byte-equal.
- [ ] 3.8 L1 test (test-plan #E3). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `fx` registered, and a second dir also declaring `fx`.
  - Trigger: register the second.
  - Observable: rejected with `duplicate-name`; the first entry is unchanged.
- [ ] 3.9 L1 test (test-plan #E4). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: entries `./skills-only`, `./`, `url`, `git-subdir p/x`, `github`, and `svn`.
  - Trigger: resolve.
  - Observable: the first five resolve to their expected roots, with github mapped to `https://github.com/<repo>.git` argv. `svn` is `unsupported/unknown-source` with no install action.
- [ ] 3.10 L1 test (test-plan #E5). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: FX-GIT with 2 commits; ref = the full SHA of the first.
  - Trigger: inspect.
  - Observable: the staged tree matches the first commit, and git argv used `fetch --depth 1 origin <sha>`.
- [ ] 3.11 L1 test (test-plan #E6). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: three entries:
    - an inline-skills entry without `strict`;
    - a `strict:false` entry whose `plugin.json` also declares commands;
    - a custom `plugin.json` skills path.
  - Trigger: classify.
  - Observable: inline skills and the `lsp` kind are found; `plugin.json` is ignored for the `strict:false` entry; custom-path skills are listed.
- [ ] 3.12 L1 test (test-plan #E7). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: three cases:
    - `source "../../etc"`;
    - a `skills` symlink pointing outside the plugin root;
    - an in-place root equal to the recorded `installPath`.
  - Trigger: resolve/classify.
  - Observable: the first two are `unsupported/path-escape`, with an fs spy showing no reads outside the roots; the third is accepted.
- [ ] 3.13 L1 test (test-plan #E8). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: FX-CLAUDE with user-scope `a` and project-scope `b` (`/w/app`), and a HOME without `.claude`.
  - Trigger: discover.
  - Observable: `a` maps to global, `b` to local `/w/app`; the missing dir gives an empty list with no throw.
- [ ] 3.14 L1 test (test-plan #E9). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: an FX-CLAUDE snapshot (sha256 + mtime per path).
  - Trigger: adopt marketplace, refresh, adopt a content-only plugin, remove it.
  - Observable: the snapshot is identical, and no git child process ran with cwd under FX-CLAUDE.
- [ ] 3.15 L1 test (test-plan #E52). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: FX-GIT marketplace with 2 plugins; `skills-only` installed.
  - Trigger: add an upstream entry and refresh, then remove the marketplace.
  - Observable: the catalogue lists 3 after refresh; after remove, the overlay, payload and settings entry are unchanged.
- [ ] 3.16 L1 test (test-plan #X1). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: FX-GIT remote deleted.
  - Trigger: refresh.
  - Observable: error with reason; the previous catalogue is served; `marketplaces.json` is unchanged.
- [ ] 3.17 L1 test (test-plan #X2). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: a stalled remote stub, with an injectable clock and timeout set to 120 s.
  - Trigger: refresh.
  - Observable: aborted at 120 s and not before 119 s; reported `timed out` naming the location; the temp checkout is absent; the previous catalogue is kept.
- [ ] 3.18 L1 test (test-plan #X3). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: a stalled remote.
  - Trigger: inspect.
  - Observable: `timed out`; no consent payload; `staging/<id>` is absent.
- [ ] 3.19 Add `AGENTS.md` rows for the new server directory and route files. Verify: `kb dox lint` reports no missing rows.

## 4. Server: import pipeline (spec `claude-plugin-import`, deltas `package-management`, `pi-resource-scanning`)

- [ ] 4.1 Implement the classifier: supported/unsupported with reasons, content-only test, self-import guard, `userConfig`, unknown hook keys. Verify: the 4.x tests below pass.
- [ ] 4.2 Implement staging (inspect, cancel delete, 1 h boot sweep) and immutable payload copies with reference counting. Verify: the 4.x tests below pass.
- [ ] 4.3 Implement the overlay generator:
  - per-install `package.json` name including `scopeKey`;
  - `extension.mjs` stub with `pathToFileURL`, try/catch and a notify on `session_start`;
  - `claude-import.json` with `projectPath`.

  Verify: the 4.x tests below pass.
- [ ] 4.4 Implement agent translation into the overlay (tools, model→`@role`, dropped fields, body substitution). Verify: the 4.x tests below pass.
- [ ] 4.5 Implement install via `package-manager-wrapper` at the chosen scope. Include the cross-marketplace refusal and the local agent-only refusal. Verify: the 4.x tests below pass.
- [ ] 4.6 Implement adoption: in place for content-only, snapshot otherwise; plus the snapshot update check. Verify: the 4.x tests below pass.
- [ ] 4.7 Add a delegation branch in the package routes for Claude-plugin sources, resolved against the settings dir (remove, update, check, move with payload reuse, 409/400, one reload), plus GC at boot and after package ops. Verify: the 4.x tests below pass.
- [ ] 4.8 Runtime copy to `runtime/<version>/` at boot, stub re-stamp, old-version cleanup, and a `doctor` check for stale stubs and orphan candidates. Verify: the 4.x tests below pass.
- [ ] 4.9 Resource scanner: report imported skills from `claude-import.json` with a managed-by marker, enabled only for the active install. Verify: test 4.33 passes.
- [ ] 4.10 L1 test (test-plan #E10). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: a `url` plugin from FX-GIT.
  - Trigger: inspect, then cancel.
  - Observable: `staging/<id>` existed after inspect and is absent after cancel; no overlay and no settings change.
- [ ] 4.11 L1 test (test-plan #E11). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `skills-only` installed global, local A and local B.
  - Trigger: remove A; update B to a new FX-GIT commit.
  - Observable: the global payload hash is unchanged; B has a new sha; the old payload is kept while referenced.
- [ ] 4.12 L1 test (test-plan #E12). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `skills-only` (relative source) installed.
  - Trigger: modify a checkout file, then refresh.
  - Observable: the installed payload hash is unchanged, and the payload path differs from the checkout path.
- [ ] 4.13 L1 test (test-plan #E13). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `skills-only` payload hashed.
  - Trigger: install, read substitution, update, remove another install.
  - Observable: payload hashes are unchanged throughout.
- [ ] 4.14 L1 test (test-plan #E14). Exemplar: `packages/server/src/package/__tests__/package-health-scanner.test.ts`.
  - Input: plugins that are md-only; md + `scripts/run.sh`; a command with inline shell; hooks; mcp.
  - Trigger: classify for adoption.
  - Observable: only the md-only plugin is in-place; the other four are snapshot.
- [ ] 4.15 L1 test (test-plan #E15). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts` (fake pi).
  - Input: content-only `a@1.0` adopted, then `installed_plugins.json` changed to `a@1.1`.
  - Trigger: `session_start`.
  - Observable: `skillPaths` are under `1.1`; agents are regenerated with the `1.1` root; no write under FX-CLAUDE.
- [ ] 4.16 L1 test (test-plan #E16). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: as 4.15, but `1.1` adds hooks.
  - Trigger: `session_start`.
  - Observable: zero registrations, one "re-adopt" notify, stored classification `needs-readopt`.
- [ ] 4.17 L1 test (test-plan #E17). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: the FX-CLAUDE `hooks` plugin.
  - Trigger: adopt with consent.
  - Observable: the payload is under store `payloads/`; the hook env `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` start with the store path.
- [ ] 4.18 L1 test (test-plan #E18). Exemplar: `packages/server/src/package/__tests__/package-health-scanner.test.ts`.
  - Input: `lsp-only`, mixed, `pi:TurnEnd` hook, required `userConfig`, `pi-dashboard@pi-agent-dashboard`.
  - Trigger: classify.
  - Observable: not installable; installable with lsp unsupported; `unknown-hook-event`; userConfig unsupported; `native-equivalent`.
- [ ] 4.19 L1 test (test-plan #E19). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `code-review` from A installed at global, local P, or none.
  - Trigger: install `code-review` from B at global, local P, or local Q.
  - Observable: refused for any overlapping scope, with the error naming A; allowed for A at local P with B at local Q.
- [ ] 4.20 L1 test (test-plan #E20). Exemplar: `packages/server/src/package/__tests__/package-health-scanner.test.ts`.
  - Input: `tools` values `Read, Grep, Glob` / `[Read]` / `Read, TodoWrite` / `TodoWrite, NotebookEdit` / `Read, Bash(git:*)` / absent / `Task`.
  - Trigger: translate.
  - Observable, in order: `[read,grep,find]` / `[read]` / `[read]`+warn / not imported (`no-mappable-tools`) / `[read]`+warn / absent+consent flag / not imported. YAML `tools` is a non-empty list whenever present.
- [ ] 4.21 L1 test (test-plan #E21). Exemplar: `packages/server/src/package/__tests__/package-health-scanner.test.ts`.
  - Input: `model` sonnet / opus / haiku / inherit / absent / `gpt-x`.
  - Trigger: translate.
  - Observable: `@coding` / `@planning` / `@fast` / unset / unset / unset+warning; consent flags roles unassigned at install.
- [ ] 4.22 L1 test (test-plan #E22). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `agents` installed globally, in three cases: no other reviewer; a project reviewer; a second plugin's reviewer.
  - Trigger: details for global and for local P.
  - Observable: active / shadowed-by-project (local view only) / shadowed-by-package naming the other plugin.
- [ ] 4.23 L1 test (test-plan #E23). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: an agent-only plugin, and an agents+skills plugin.
  - Trigger: install at local scope.
  - Observable: the first gets 400 with global offered; the second installs, with details flagging agents unavailable.
- [ ] 4.24 L1 test (test-plan #E24). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: three overlays: global with its entry hand-removed; local whose project dir was deleted; local with its entry hand-removed.
  - Trigger: boot GC.
  - Observable: the first is deleted along with its unreferenced payload; the second is kept and reported as a doctor orphan candidate; the third is deleted.
- [ ] 4.25 L1 test (test-plan #E25). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: global and local installs via a real `DefaultPackageManager` (temp agentDir/cwd).
  - Trigger: read settings, then remove by the stored source.
  - Observable: the sources are relative; delegation resolves them to the overlay realpath; remove succeeds.
- [ ] 4.26 L1 test (test-plan #E26). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `hooks` installed global and local, with a file in `data/`.
  - Trigger: remove local, then global.
  - Observable: after the first, data and payload exist; after the second, overlay, payload and the data dir are gone.
- [ ] 4.27 L1 test (test-plan #E27). Exemplar: `packages/server/src/package/__tests__/package-health-scanner.test.ts`.
  - Input: the same plugin installed global and local.
  - Trigger: run the package-health scanner.
  - Observable: no `duplicate` status; the names differ by `scopeKey`.
- [ ] 4.28 L1 test (test-plan #E28). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `skills-only` global (sha S).
  - Trigger: move to local; repeat with the destination already installed; move an agent-only plugin to local.
  - Observable: the local overlay has payload S, the global is removed, reload count is 1, no git process ran; then 409 with nothing changed; then 400.
- [ ] 4.29 L1 test (test-plan #E47). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: overlays stamped to runtime v1; boot with bundled v2.
  - Trigger: boot.
  - Observable: stubs point at v2; the v1 dir is kept while referenced and deleted after.
- [ ] 4.30 L1 test (test-plan #E53). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `hooks@1.0` adopted as a snapshot; `installed_plugins.json` changed to `1.1`.
  - Trigger: check for updates, then update.
  - Observable: reported updatable; a new store snapshot of `1.1`; FX-CLAUDE unchanged.
- [ ] 4.31 L1 test (test-plan #X4). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: `staging/a` with mtime 61 min old; `staging/b` 59 min old.
  - Trigger: boot.
  - Observable: `a` is deleted, `b` is kept.
- [ ] 4.32 L1 test (test-plan #X13). Exemplar: `packages/server/src/__tests__/package-routes.test.ts`.
  - Input: the package queue is running another install.
  - Trigger: install a Claude plugin.
  - Observable: 409 busy; no overlay or staging is left.
- [ ] 4.33 L1 test (test-plan #E51). Exemplar: `packages/server/src/__tests__/pi-resource-scanner.test.ts`.
  - Input: global `skills-only` active, plus a local install overriding it.
  - Trigger: scan global cwd and local cwd.
  - Observable: skills carry the managed-by marker and package provenance; they are enabled for the active install only.
- [ ] 4.34 Run the `Audit` subagent on the import-pipeline diff (untrusted manifests, paths, git argv, staging, GC deletes). Fix blocking findings. Verify: the Audit report has no open blocking item.
- [ ] 4.35 Add `AGENTS.md` rows for the new and changed server files. Verify: `kb dox lint` is clean for them.
- [ ] 4.36 Verify group 4 in full: `npm test -- packages/server` is green with all 4.x tests.

## 5. Bridge: follow-up handoff and prompt announcement (delta `mid-turn-prompt-queue`)

- [ ] 5.1 Implement the bridge `pi.events` follow-up handoff listener (buffer while streaming, fresh turn when idle, ack). Verify: test 5.3 passes.
- [ ] 5.2 Implement the bridge user-prompt announcement before `sendUserMessage`, for dashboard user prompts only. Verify: test 5.4 passes.
- [ ] 5.3 L1 test (test-plan #E48). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: streaming with 1 buffered follow-up, then idle.
  - Trigger: emit a handoff.
  - Observable: while streaming, it is appended as the last buffer entry with a `queue_update` and an ack; while idle, `sendUserMessage` sends a fresh turn.
- [ ] 5.4 L1 test (test-plan #E49). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: a dashboard user prompt, a drained system follow-up, and an executable template.
  - Trigger: deliver each.
  - Observable: an announcement is emitted only for the user prompt, and before `sendUserMessage`.
- [ ] 5.5 Run `npm run reload` and confirm that dashboard follow-ups and prompts behave unchanged in a live session. Verify: queue chip and chat order are unchanged for a typed follow-up.

## 6. Runtime compat, phase 1 (spec `claude-plugin-runtime-compat`: instance, skills, paths, commands, MCP, env)

- [ ] 6.1 Implement the election, hooks-first fail-closed registration order, and skills via `resources_discover`. Verify: the 6.x tests below pass.
- [ ] 6.2 Implement path-variable substitution (read results by realpath; TUI `/skill:`; dashboard-expanded `<skill>` blocks). Verify: the 6.x tests below pass.
- [ ] 6.3 Implement commands: names, expansion order, 30 s inline timeout, 50,000-character cap, busy handoff with a 200 ms ack and refusal fallback, self-sent set. Verify: the 6.x tests below pass.
- [ ] 6.4 Implement MCP registration (both shapes, http, env expansion, missing-env warning) and the child-process env (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_DATA`). Verify: the 6.x tests below pass.
- [ ] 6.5 L1 test (test-plan #E29). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts` (fake pi).
  - Input: global and local stubs of `mcp-flat`, as two API objects with the same session id.
  - Trigger: `session_start` ×2, then `resources_discover`.
  - Observable: exactly one `registerMcpServer("mcp-flat__docs")` and one skill/command set, all from local; global details show `overridden by local`.
- [ ] 6.6 L1 test (test-plan #E30). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: parent session P with the plugin active; child session C in the same process.
  - Trigger: C `session_start` + `resources_discover`, then C shutdown.
  - Observable: C registers its own set; P's entries are unchanged; C's entries are removed on shutdown.
- [ ] 6.7 L1 test (test-plan #E31). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: plugins `a` and `b` whose `SKILL.md` contains `${CLAUDE_PLUGIN_ROOT}`, plus a project file containing the same literal.
  - Trigger: `tool_result` for a read of each, including via a symlinked path to `a`.
  - Observable: `a` gets `a`'s root, `b` gets `b`'s root, the project file is unchanged, and the symlinked read is substituted.
- [ ] 6.8 L1 test (test-plan #E32). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: a bridge-expanded `<skill location=payload…>` block containing `${CLAUDE_SKILL_DIR}`, and a block whose location is outside any plugin.
  - Trigger: `input` with source `extension`.
  - Observable: the first is transformed with the absolute skill dir; the second is `continue`, unchanged.
- [ ] 6.9 L1 test (test-plan #E33). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: three cases: `x` with review; `x` and `y` both with review; `registerCommand` throws for one name.
  - Trigger: register.
  - Observable: `/x:review` + `/review`; `/x:review` and `/y:review` with no bare alias; for the throwing case, a warning while the other commands still register.
- [ ] 6.10 L1 test (test-plan #E34). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: body ``Fix $1. !`echo hi` @README.md``; args ``42 !`touch /tmp/pwn` @/etc/passwd``.
  - Trigger: invoke.
  - Observable: the args appear literally, the `hi` output and README content are spliced in, `/tmp/pwn` is not created, and passwd is not read.
- [ ] 6.11 L1 test (test-plan #E35). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: body `@link` (symlink to `/etc/hosts`) and body `@../outside.txt`.
  - Trigger: invoke.
  - Observable: neither is inlined; both get the note "outside allowed roots".
- [ ] 6.12 L1 test (test-plan #E36). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: an inline cmd printing 49,999 / 50,000 / 50,001 chars; a SessionStart hook printing 50,000 / 50,001 chars.
  - Trigger: invoke / `session_start`.
  - Observable: ≤50,000 is verbatim with no note; 50,001 gives the first 50,000 plus a truncation note naming the plugin.
- [ ] 6.13 L1 test (test-plan #E37). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: `mcp-flat`, `mcp-wrapped`, `mcp-http`; configs with `${TFE_TOKEN}` unset, `${TFE_TOKEN:-x}`, and `${CLAUDE_PLUGIN_ROOT}`.
  - Trigger: register.
  - Observable: three prefixed servers, http with its url; unset without default is skipped with a warning naming the var; the default gives `x`; the root is substituted.
- [ ] 6.14 L1 test (test-plan #E44). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: a fake pi whose `registerMcpServer` throws; separately, one whose hook registration throws.
  - Trigger: register.
  - Observable: first case: hooks and skills registered, MCP rolled back, no commands, one notify. Second case: nothing registered, one notify.
- [ ] 6.15 L1 test (test-plan #E46). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: a generated `extension.mjs` pointing at a missing runtime file.
  - Trigger: load with a fake pi and fire `session_start`.
  - Observable: the factory resolves; zero registrations; exactly one notify naming `<mkt>/<plugin>`.
- [ ] 6.16 L1 test (test-plan #E50). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: a streaming session with no handoff ack within 200 ms.
  - Trigger: invoke `/x:review`.
  - Observable: no `sendUserMessage`; one notify "run when idle".
- [ ] 6.17 L1 test (test-plan #X5). Exemplar: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.
  - Input: a content-only adopted plugin whose `installPath` dir or entry was removed.
  - Trigger: `session_start`.
  - Observable: zero registrations, exactly one notify naming the plugin, and the session starts.
- [ ] 6.18 L1 test (test-plan #X11). Exemplar: `packages/extension/src/__tests__/prompt-expander.test.ts`.
  - Input: ``!`exit 3` `` and ``!`sleep 40` ``.
  - Trigger: invoke.
  - Observable: a marked note with status 3; a timeout note at 30 s; the message is still sent.
- [ ] 6.19 Live check: install a fixture plugin (skill + command + stdio MCP) in the local dashboard and use all three in a real pi session. Verify: the transcript shows the resolved path, the expanded command and an MCP tool call.

## 7. Client: Claude marketplaces view (deltas `package-browse`, `pi-resources-view`)

- [ ] 7.1 Implement the Claude marketplaces view in `PackageBrowser`: list, add, refresh, remove, adopt suggestions, Inspect. Verify: the 7.x tests below pass.
- [ ] 7.2 Implement plugin cards, the consent dialog extension, installed-row marker and details panel, the identity-keyed cross-scope badge, and the read-only Resources rows. Verify: the 7.x tests below pass.
- [ ] 7.3 L1 test (test-plan #F2). Exemplar: `packages/client/src/components/__tests__/PackageBrowser.installed-section.test.tsx`.
  - Input: catalogue entries `skills-only`, `lsp-only`, remote-uninspected, adopted.
  - Trigger: render.
  - Observable: badges per kind; `lsp-only` shows Unsupported with no Install; the remote entry shows Inspect; the adopted marker shows.
- [ ] 7.4 L1 test (test-plan #F3). Exemplar: `packages/client/src/components/__tests__/PackageInstallConfirmDialog.test.tsx`.
  - Input: a PreToolUse `node scripts/guard.js` hook (interpreter missing), and an http MCP using `${GITHUB_PERSONAL_ACCESS_TOKEN}`.
  - Trigger: render consent.
  - Observable: the hook row with "interpreter missing"; the MCP URL and var name; the var value never in the DOM; the third-party label on both.
- [ ] 7.5 L1 test (test-plan #F4). Exemplar: `packages/client/src/components/__tests__/PackageInstallConfirmDialog.test.tsx`.
  - Input: agents `Read, TodoWrite` sonnet (role unassigned), no-tools, all-unmappable; local scope; a skill collision; snapshot adoption.
  - Trigger: render consent.
  - Observable: dropped `TodoWrite` and coding role with an unassigned warning; inherit note; not-imported row; local agents note; collision row; snapshot note.
- [ ] 7.6 L1 test (test-plan #F7). Exemplar: `packages/client/src/components/__tests__/PackageBrowser.installed-section.test.tsx`.
  - Input: global + local installs of the same `mkt/plugin` with different sources, plus a plain path package in both scopes.
  - Trigger: render.
  - Observable: the Claude row shows the cross-scope badge; the plain row is still keyed by source.
- [ ] 7.7 L1 test (test-plan #F8). Exemplar: `packages/client/src/components/__tests__/PackageBrowser.installed-section.test.tsx`.
  - Input: a scan with a managed-by-Claude skill and a normal package skill.
  - Trigger: render the Resources surface.
  - Observable: the Claude row shows "managed by Claude plugin x" with no toggle; the normal row has a toggle.
- [ ] 7.8 L3 test (test-plan #F1). Exemplar: `tests/e2e/package-queue-visible.spec.ts`.
  - Input: harness with FX-MKT mounted and FX-CLAUDE holding 2 known marketplaces.
  - Trigger: open Packages → Claude marketplaces, then add the FX-MKT path.
  - Observable: the empty state shows 2 adopt suggestions; after add, the list converges to the FX-MKT plugin rows.
- [ ] 7.9 L3 test (test-plan #F5). Exemplar: `tests/e2e/package-queue-visible.spec.ts`.
  - Input: a remote FX-GIT plugin.
  - Trigger: Inspect → consent → Cancel.
  - Observable: the dialog closes; `staging/` is empty (harness fs); the plugin is not in the Installed list.
- [ ] 7.10 L3 test (test-plan #F6). Exemplar: `tests/e2e/package-queue-visible.spec.ts`.
  - Input: `skills-only`.
  - Trigger: install globally.
  - Observable: the Packages Installed section and the Settings package list both show the row with a Claude marker naming FX-MKT; details show provenance.
- [ ] 7.11 L3 test (test-plan #F9). Exemplar: `tests/e2e/followup-image-queue.spec.ts`.
  - Input: a harness session streaming a long fake turn; `cmds` installed; 1 typed follow-up queued.
  - Trigger: send `/cmds:review 42` from the dashboard.
  - Observable: the queue shows the typed entry, then the expansion; after settle, both are delivered in order.
- [ ] 7.12 Visual polish of the consent dialog for a 6-component plugin: readability and scannability of warnings, reviewed by a human (test-plan: manual-only, #F11).
- [ ] 7.13 Run a `react-expert` review (≥3 components touched), then `npm run build`, restart the server, and check through isolated UI verification. Verify: screenshots of the view, consent dialog, installed row and read-only Resources row.

## 8. Runtime compat, phase 2: hooks (design D7)

- [ ] 8.1 Implement the hook runner: stdin JSON, seconds timeout, sequential runs, 50,000-character cap, interpreter preflight, `CLAUDE_ENV_FILE`. Verify: the 8.x tests below pass.
- [ ] 8.2 Implement the event wiring:
  - SessionStart source mapping, with no run on reload;
  - UserPromptSubmit gating via sources and the bridge announcement;
  - Stop via `agent_settled`.

  Verify: the 8.x tests below pass.
- [ ] 8.3 Implement tool-input translation, the matcher semantics, multi-run composition, `updatedInput` mapping, and the bash env prefix after hooks. Verify: the 8.x tests below pass.
- [ ] 8.4 L1 test (test-plan #E38). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: the `hooks` plugin; events `session_start` (startup, reload, new, resume, fork), `session_compact`, `agent_end` ×2 then `agent_settled`, and `agent_settled` aborted.
  - Trigger: fire each.
  - Observable: sources startup / none / clear / resume / resume / compact; Stop exactly once; StopFailure once on aborted.
- [ ] 8.5 L1 test (test-plan #E39). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: matchers `resume`, `startup|clear`, absent.
  - Trigger: `session_start` reasons.
  - Observable: `resume` runs only on resume/fork; `startup|clear` on startup/new; absent on all reasons except reload.
- [ ] 8.6 L1 test (test-plan #E40). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: input events from interactive; rpc; extension with announcement; extension without announcement; self-sent text.
  - Trigger: `input`.
  - Observable: the hook runs for the first three, and not for the last two.
- [ ] 8.7 L1 test (test-plan #E41). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: a hook returning additionalContext; input with `streamingBehavior: "followUp"`.
  - Trigger: `input`.
  - Observable: `continue` with text unchanged; no `before_agent_start` message queued; a warning naming the hook.
- [ ] 8.8 L1 test (test-plan #E42). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: matchers `Bash`, `Edit|Write`, absent, `*`, `^mcp__.*`; calls to bash, edit, write, `mcp__x__y`, `custom_tool`.
  - Trigger: `tool_call`.
  - Observable: regex full-match on the Claude name; absent and `*` match all, with `custom_tool` receiving the pi name; `Edit|Write` never matches `custom_tool`.
- [ ] 8.9 L1 test (test-plan #E43). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: an edit call with 3 replacements; per-run outcomes allow×3; allow/block/allow; non-conflicting updates; conflicting updates.
  - Trigger: `tool_call`.
  - Observable: 3 runs with Claude Edit fields; one block blocks the whole call; non-conflicting updates are applied per edit; a conflict blocks with a reason.
- [ ] 8.10 L1 test (test-plan #E45). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: SessionStart writes `export FOO=1` to `$CLAUDE_ENV_FILE`; a guard blocks `^rm`.
  - Trigger: a PostToolUse hook; bash `echo $FOO`; bash `rm x`.
  - Observable: the hook env has FOO=1; the bash command is prefixed with `. "<file>" &&`; the guard receives `rm x` unprefixed and blocks it.
- [ ] 8.11 L1 test (test-plan #X6). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: a Bash guard that exits 2 with stderr `rm is forbidden`.
  - Trigger: `tool_call` bash `rm x`.
  - Observable: `{block: true, reason: "rm is forbidden"}`.
- [ ] 8.12 L1 test (test-plan #X7). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: a hook running `sleep 5` with `timeout: 1`; a hook exiting 1 with garbage stdout.
  - Trigger: `tool_call`.
  - Observable: the timeout blocks with a timeout reason at about 1 s; the crash blocks.
- [ ] 8.13 L1 test (test-plan #X8). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: a no-matcher PreToolUse `python3 hook.py` with PATH lacking python3.
  - Trigger: `session_start`, then two tool calls.
  - Observable: one degraded notify per session; both calls blocked with a reason naming `python3` and the plugin.
- [ ] 8.14 L1 test (test-plan #X9). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: PostToolUse exits 1; Stop outputs a block decision.
  - Trigger: `tool_result`; `agent_settled`.
  - Observable: the result is unchanged with a warning; the Stop block is ignored with a warning; the run ends.
- [ ] 8.15 L1 test (test-plan #X10). Exemplar: `packages/extension/src/__tests__/bridge-agent-settled-contract.test.ts`.
  - Input: PreToolUse on Edit returns `updatedInput` containing only an unknown field.
  - Trigger: `tool_call`.
  - Observable: blocked with reason "update could not be applied".
- [ ] 8.16 L3 test (test-plan #F10). Exemplar: `tests/e2e/followup-image-queue.spec.ts`.
  - Input: the `hooks` plugin whose UserPromptSubmit exits 2 on `secret`.
  - Trigger: send `my secret` from the dashboard.
  - Observable: a notification shows the reason; no assistant message within 10 s; the session stays idle.
- [ ] 8.17 L3 test (test-plan #X12). Exemplar: `tests/e2e/package-queue-visible.spec.ts`.
  - Input: the `hooks` plugin installed globally, then its runtime file deleted.
  - Trigger: start a new session.
  - Observable: the session card becomes active; one error notification names the plugin; bash `rm x` is not blocked.
- [ ] 8.18 Run the `Audit` subagent on the hook runner (process spawning, env leakage, timeouts, fail-closed paths, output cap). Fix blocking findings. Verify: the Audit report has no open blocking item.
- [ ] 8.19 Live check with a real `claude-plugins-official` plugin that uses PostToolUse + SessionStart hooks. Verify: the transcript shows the injected context and the hook run.

## 9. Documentation

- [ ] 9.1 Delegate to `DocScribe`:
  - `docs/claude-marketplace-plugins.md` (user flow, store layout, support matrix, hook mapping, limits and trade-offs);
  - a `docs/features.md` entry;
  - a `docs/faq.md` entry "How do I use Claude Code marketplace plugins in pi?".

  Verify: `kb_search "claude marketplace plugins"` returns the new doc, and `kb dox lint` is clean.

## 10. Integration

- [ ] 10.1 Full run: `npm test` green, `npm run quality:changed` clean, `openspec validate add-claude-marketplace-plugins --strict` passes, and `npm run test:e2e` passes for the 6 new L3 specs. Verify: `/tmp/pi-test.log` shows no failures.

## Workflow follow-up

- Follow-up change: pi-specific hook events (`pi:*` mapped events, `bus:<channel>` on `pi.events`); see design.md Non-Goals.
- Follow-up change in `pi-dashboard-subagents`: index trusted project-scope packages in the package agent tier, so agents of locally installed Claude plugins resolve.
- Archive the change after review requirements are satisfied (`ship-change`).
