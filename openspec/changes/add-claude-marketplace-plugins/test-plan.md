# Test Plan — add-claude-marketplace-plugins

Stage: design   Generated: 2026-10-24

Hard gate passed. Four slots were resolved with the user:
- git timeout 120 s;
- context output cap 50,000 characters;
- no per-tool-call budget;
- no catalogue-listing budget.

Because of the last two, there are no performance scenarios (design.md "Performance").

Fixture conventions (used by Input slots):
- `FX-MKT`: a local-directory marketplace under test fixtures, with plugins:
  - `skills-only`: two skills, one referencing `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`;
  - `cmds`: `commands/review.md` with `` !`echo hi` ``, `$1`, `@README.md`;
  - `agents`: `reviewer.md` with `tools: Read, Grep, Glob` and `model: sonnet`;
  - `hooks`: hooks.json with PreToolUse `Bash` exit-2 guard, a no-matcher PreToolUse, SessionStart, PostToolUse, Stop;
  - `mcp-flat` / `mcp-wrapped` / `mcp-http`;
  - `lsp-only`;
  - `inline-strict-absent` (marketplace entry with inline `skills` and no `strict`).
- `FX-GIT`: a local bare git repo served via `file://`. A slow variant uses a stalled `git-http-backend` stub.
- `FX-CLAUDE`: a fake `~/.claude/plugins` tree (`known_marketplaces.json`, `installed_plugins.json` v2, `cache/<mkt>/<plugin>/<ver>/`), with HOME redirected.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sources: Register a marketplace | EP | L1 | automated | dir with valid `.claude-plugin/marketplace.json` (`name: fx`, 9 plugins) | register | registry lists `fx` with 9 entries; `marketplaces.json` persisted; re-instantiate registry → still 9 |
| E2 | sources: Register (invalid) | EP | L1 | automated | three dirs: no manifest / invalid JSON / no `plugins` array | register each | each rejected with error naming the file or parse reason; `marketplaces.json` unchanged (byte-equal) |
| E3 | sources: Duplicate names refused | decision-table | L1 | automated | `fx` registered; second dir declaring `fx` | register second | rejected `duplicate-name`; first entry's location unchanged |
| E4 | sources: Source shapes | decision-table | L1 | automated | entries: `"./skills-only"`, `"./"`, `{url}`, `{git-subdir, path:"p/x"}`, `{github, repo}`, `{source:"svn"}` | resolve | first five resolve to expected roots (github → `https://github.com/<repo>.git` argv); `svn` → `unsupported/unknown-source`, install action absent |
| E5 | sources: Ref pinned to commit | EP | L1 | automated | FX-GIT with 2 commits; entry `ref: <full sha of first>` | inspect | staged tree matches first commit (file absent from second commit present); git argv used `fetch --depth 1 origin <sha>`, not `--branch` |
| E6 | sources: Component locations | decision-table | L1 | automated | `inline-strict-absent`; `strict:false` entry with plugin.json also declaring `commands`; plugin.json custom `skills` path | classify | first: inline skills found + `lsp` kind; second: plugin.json ignored; third: custom path skills listed |
| E7 | sources: Paths stay inside roots | BVA | L1 | automated | `source: "../../etc"`; plugin with `skills` → symlink to `/tmp/outside`; in-place adoption root = recorded `installPath` | resolve/classify | first two `unsupported/path-escape`, no read outside roots (fs spy); third accepted |
| E8 | sources: Discovery | EP | L1 | automated | FX-CLAUDE with user-scope `a`, project-scope `b` (`projectPath:/w/app`); and HOME without `.claude` | discover | `a` → global, `b` → local `/w/app`; missing dir → empty list, no throw |
| E9 | sources: Never write Claude dirs | invariant | L1 | automated | FX-CLAUDE snapshot (path → sha256 + mtime) | adopt marketplace, refresh, adopt content-only plugin, remove it | snapshot identical; no git child process with cwd under FX-CLAUDE |
| E10 | import: Inspect before consent | state-transition | L1 | automated | `{url}` plugin from FX-GIT | inspect → cancel | `staging/<id>` existed after inspect, absent after cancel; no overlay, no settings change |
| E11 | import: Installs independent | state-transition | L1 | automated | `skills-only` installed global + local(A) + local(B) | remove local(A); update local(B) with FX-GIT new commit | global and local(A→gone) overlays: global payload hash unchanged; B's payload new sha; global still references old payload; old payload kept while referenced |
| E12 | import: Payload immutable vs marketplace | state-transition | L1 | automated | `skills-only` (relative source) installed | modify file in marketplace checkout; refresh marketplace | installed payload file hash unchanged; payload path ≠ checkout path |
| E13 | import: Files never modified | invariant | L1 | automated | `skills-only` payload hashed | install, run D2 read substitution, update, remove another install | payload hashes unchanged throughout |
| E14 | import: Content-only classification | decision-table | L1 | automated | plugins: md-only; md + `scripts/run.sh`; command with `` !`x` ``; hooks; mcp | classify for adoption | only md-only → `in-place`; other four → `snapshot` |
| E15 | import: In-place live version | state-transition | L1 | automated | FX-CLAUDE content-only `a@1.0` adopted; then `installed_plugins.json` → `a@1.1` (new dir) | session_start (runtime with fake pi) | skillPaths under `1.1`; agents regenerated with `1.1` root; no write under FX-CLAUDE |
| E16 | import: In-place version gains a hook | state-transition | L1 | automated | as E15, but `1.1` adds `hooks/hooks.json` | session_start | plugin registers nothing; one `notify` "re-adopt"; classification stored `needs-readopt` |
| E17 | import: Executable adoption snapshots | EP | L1 | automated | FX-CLAUDE `hooks` plugin | adopt (consent confirmed) | payload under store `payloads/`; hook env `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` start with store path, never FX-CLAUDE |
| E18 | import: Classification | decision-table | L1 | automated | `lsp-only`; `skills+.lsp.json`; hooks key `pi:TurnEnd`; required `userConfig`; `pi-dashboard@pi-agent-dashboard` | classify | `lsp-only` not installable; mixed installable with lsp unsupported; `unknown-hook-event`; `userConfig` unsupported; `native-equivalent` |
| E19 | import: Cross-marketplace refusal | decision-table | L1 | automated | `code-review` from A installed {global, local(P), none}; install `code-review` from B at {global, local(P), local(Q)} | install | refused when A@global (any B scope) or A@local(P)+B@local(P)/global; allowed A@local(P)+B@local(Q); error names A |
| E20 | import: Agent tools never widen | EP + BVA | L1 | automated | `tools`: `Read, Grep, Glob` / `[Read]` / `Read, TodoWrite` / `TodoWrite, NotebookEdit` / `Read, Bash(git:*)` / absent / `Task` | translate | `[read,grep,find]` / `[read]` / `[read]`+warn / not imported `no-mappable-tools` / `[read]`+warn / absent+consent flag / not imported; generated YAML `tools` always a non-empty list when present |
| E21 | import: Model aliases | decision-table | L1 | automated | `model`: sonnet/opus/haiku/inherit/absent/`gpt-x` | translate | `@coding`/`@planning`/`@fast`/unset/unset/unset+warning; consent payload flags roles unassigned at install |
| E22 | import: Agent resolution & shadowing | decision-table | L1 | automated | `agents` installed globally; cases: no other `reviewer`; project `.pi/agents/reviewer.md`; second plugin with `reviewer` | details for scope (global / local P) | active / shadowed-by-project (local view only) / shadowed-by-package naming the other plugin |
| E23 | import: Local agent-only | decision-table | L1 | automated | plugin with only agents; plugin with agents + skills | install local | first: local not offered (400 from API), global offered; second: installed, details flag agents unavailable |
| E24 | import: Orphan GC | state-transition | L1 | automated | global overlay; local overlay whose project dir deleted; local overlay whose project settings entry removed by hand | server boot GC | global entry removed by hand → overlay deleted + payload unreferenced deleted; deleted-project overlay kept + doctor orphan candidate; hand-removed local → deleted |
| E25 | import: Relative settings paths | EP | L1 | automated | install global and local via real `DefaultPackageManager` (temp agentDir/cwd) | read settings, then delegate remove by the stored source | stored sources are relative; delegation resolves them to the overlay realpath; remove succeeds |
| E26 | import: Last install removal | state-transition | L1 | automated | `hooks` installed global + local; `data/` has a file | remove local, then global | after first: data and payload exist; after second: overlay, payload, `data/<mkt>/<plugin>` gone |
| E27 | import: Per-install package name | EP | L1 | automated | same plugin installed global + local | run package-health scanner | no `duplicate` status; names differ by scopeKey |
| E28 | package-management: Move by reuse | state-transition | L1 | automated | `skills-only` global (sha S) | `POST /api/packages/move` → local; repeat with destination already installed; agent-only → local | first: local overlay with payload sha S, global removed, reload count 1, no git process; second: 409, nothing changed; third: 400 |
| E29 | runtime: One instance, local wins | state-transition | L1 | automated | two stubs (global, local) of `mcp-flat` loaded into one fake session (two distinct `pi` API objects, same session id) | session_start ×2 → resources_discover | exactly one `registerMcpServer("mcp-flat__docs")`, one skill set, one command set, all from local; global details `overridden by local` |
| E30 | runtime: Subagent session isolation | state-transition | L1 | automated | same process; parent session id P with plugin active; child session id C | child session_start + resources_discover; then child shutdown | C registers its own set; P's registry entries unchanged; C entries removed on `session_shutdown` |
| E31 | runtime: Path variables per plugin | EP | L1 | automated | plugins `a`,`b` each with `SKILL.md` containing `${CLAUDE_PLUGIN_ROOT}`; project file with the same literal | `tool_result` for read of each | `a` text has `a` root, `b` text has `b` root, project file unchanged; also via symlinked path to `a` (realpath match) |
| E32 | runtime: Dashboard `/skill:` block | EP | L1 | automated | `input` text = bridge-expanded `<skill name="x" location="<payload>/skills/x/SKILL.md">…${CLAUDE_SKILL_DIR}…</skill>` source `extension`; also a block with location outside any plugin | input | first transformed with absolute skill dir; second unchanged (`continue`) |
| E33 | runtime: Command names | decision-table | L1 | automated | active plugins {`x` with review}, {`x`,`y` both review}, registerCommand throws for one name | session register | `/x:review`+`/review`; `/x:review`,`/y:review`, no bare; throwing one → warning, other commands still registered |
| E34 | runtime: Expansion & injection | EP | L1 | automated | body ``Fix $1. !`echo hi` @README.md``; args ``42 !`touch /tmp/pwn` @/etc/passwd`` | invoke | message = `Fix 42 !\`touch /tmp/pwn\` @/etc/passwd. hi <README content>` with the args literal; `/tmp/pwn` not created; passwd not read |
| E35 | runtime: `@path` containment | BVA | L1 | automated | body `@link` where `link` → symlink to `/etc/hosts`; body `@../outside.txt` | invoke | neither inlined; note "outside allowed roots" for both |
| E36 | runtime: Output cap | BVA | L1 | automated | inline cmd printing 49,999 / 50,000 / 50,001 chars; SessionStart hook printing 50,000 / 50,001 | invoke / session_start | ≤50,000 → verbatim, no note; 50,001 → first 50,000 + truncation note naming plugin |
| E37 | runtime: MCP shapes & env | decision-table | L1 | automated | `mcp-flat`, `mcp-wrapped`, `mcp-http`; config with `${TFE_TOKEN}` unset / `${TFE_TOKEN:-x}` / `${CLAUDE_PLUGIN_ROOT}` | register | three servers registered with prefixed names, http with url; unset w/o default → not registered + warning naming var; default → `x`; root substituted |
| E38 | runtime: Hook event mapping | decision-table | L1 | automated | hooks plugin; pi events: session_start{startup,reload,new,resume,fork}, session_compact, agent_end ×2 then agent_settled{aborted:false}, agent_settled{aborted:true} | fire | SessionStart sources startup/—/clear/resume/resume/compact (reload none); Stop exactly once; StopFailure once on aborted |
| E39 | runtime: SessionStart matcher | decision-table | L1 | automated | hooks with matcher `resume`, `startup|clear`, absent | session_start reasons | matcher `resume` only on resume/fork; `startup|clear` on startup/new; absent on all except reload |
| E40 | runtime: UserPromptSubmit sources | decision-table | L1 | automated | input events: source interactive; rpc; extension + bridge announcement (same text); extension without announcement; self-sent expanded command text | input | hook runs for first three; not for last two |
| E41 | runtime: UserPromptSubmit queued context | state-transition | L1 | automated | hook returns additionalContext; input with `streamingBehavior: "followUp"` | input | `continue` with text unchanged; no `before_agent_start` message queued; warning naming hook |
| E42 | runtime: Tool matcher semantics | decision-table | L1 | automated | PreToolUse matchers `Bash`, `Edit|Write`, absent, `*`, `^mcp__.*`; calls bash, edit, write, `mcp__x__y`, `custom_tool` | tool_call | regex full-match on Claude name; absent/`*` match all incl. `custom_tool` (receives pi name); `Edit|Write` never matches `custom_tool` |
| E43 | runtime: Edit translation & composition | decision-table | L1 | automated | edit call with 3 replacements; hook outcomes per run: allow/allow/allow; allow/block/allow; update/update(no conflict); update/update(conflict same field) | tool_call | 3 runs with `{file_path, old_string, new_string}`; block → whole call blocked; non-conflicting updates applied to matching `edits[i]`; conflict → blocked with reason |
| E44 | runtime: Fail-closed registration order | state-transition | L1 | automated | fake pi where `registerMcpServer` throws; separately where hook handler registration throws | session register | first: hooks + skills registered, MCP rolled back, commands not registered, one notify; second: nothing registered, one notify |
| E45 | runtime: Env file | state-transition | L1 | automated | SessionStart writes `export FOO=1` to `$CLAUDE_ENV_FILE`; PreToolUse guard blocks `^rm` | later PostToolUse hook; bash `echo $FOO`; bash `rm x` | PostToolUse env has FOO=1; bash command mutated to `. "<file>" && echo $FOO`; guard receives `rm x` unprefixed and blocks |
| E46 | runtime: Stub fail-closed | EP | L1 | automated | generated `extension.mjs` pointing at a missing runtime file | load stub with fake pi, fire session_start | factory resolves; zero registrations; exactly one `notify` naming `<mkt>/<plugin>` |
| E47 | runtime: Runtime re-stamp | state-transition | L1 | automated | overlays stamped to runtime v1; server boots with bundled v2 | boot | stubs point at v2; v1 dir kept while any stub references it, deleted after none do |
| E48 | mid-turn-prompt-queue: Follow-up handoff | state-transition | L1 | automated | bridge with streaming=true and 1 existing buffered follow-up; then streaming=false | emit handoff on `pi.events` | streaming: appended as last buffer entry + `queue_update`, ack emitted; idle: `sendUserMessage` fresh turn |
| E49 | mid-turn-prompt-queue: Prompt announcement | decision-table | L1 | automated | bridge sends: dashboard user prompt; drained system follow-up; executable template | deliver | announcement emitted only for the user prompt, before `sendUserMessage` |
| E50 | runtime: Busy command without bridge | state-transition | L1 | automated | claude-compat in streaming session; no handoff ack within 200 ms | invoke `/x:review` | no `sendUserMessage`; one notify "run when idle" |
| E52 | sources: Refresh and remove | state-transition | L1 | automated | FX-GIT marketplace with 2 plugins; `skills-only` installed from it | add a plugin entry upstream + refresh; then remove marketplace | catalogue lists 3 after refresh; after remove, marketplace absent and `skills-only` overlay, payload and settings entry unchanged |
| E53 | import: Snapshot update check | state-transition | L1 | automated | FX-CLAUDE `hooks@1.0` adopted as snapshot; `installed_plugins.json` changed to `1.1` | check for updates; update | reported updatable; after update, payload is a new snapshot of `1.1` in the store; FX-CLAUDE unchanged |
| E51 | pi-resource-scanning: Imported skills | EP | L1 | automated | global `skills-only` install active; second local install overriding | scan global cwd / scan local cwd | skills reported with managed-by marker, package provenance; enabled for the active install only |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | package-browse: Marketplaces surface | state-transition | L3 | automated | harness with FX-MKT dir mounted; FX-CLAUDE with 2 known marketplaces | open Packages → Claude marketplaces; add FX-MKT path | empty state shows 2 adopt suggestions; after add, list converges to FX-MKT's plugin rows |
| F2 | package-browse: Badges & unsupported | EP | L1 | automated | catalogue entries for `skills-only`, `lsp-only`, remote-uninspected, adopted | render cards | badges per kind; `lsp-only` Unsupported + no Install; remote shows Inspect; adopted marker |
| F3 | package-browse: Consent executable | EP | L1 | automated | classification with PreToolUse `node scripts/guard.js` (interpreter missing), http MCP with `${GITHUB_PERSONAL_ACCESS_TOKEN}` | render consent | hook row event/matcher/command + "interpreter missing"; MCP URL + var name; value never in DOM; third-party label on both |
| F4 | package-browse: Consent narrowing | EP | L1 | automated | agents: `Read, TodoWrite` sonnet (role unassigned); no tools; all-unmappable; local scope; skill collision; snapshot adoption | render consent | dropped `TodoWrite`, coding role + unassigned warning; inherit note; not-imported row; local agents note; collision row; snapshot note |
| F5 | package-browse: Cancel discards | state-transition | L3 | automated | remote FX-GIT plugin | Inspect → consent → Cancel | dialog closes; `staging/` empty (harness fs); plugin not in Installed list |
| F6 | package-browse: Install → installed row everywhere | state-transition | L3 | automated | `skills-only` | install global | Packages Installed section and Settings package list both show row with Claude marker naming FX-MKT; details show provenance |
| F7 | package-browse (MODIFIED): Cross-scope badge | state-transition | L1 | automated | installedInfo with global+local installs of same `mkt/plugin` but different sources; plus plain local-path package in both scopes | render | Claude row shows cross-scope badge (identity-keyed); plain path row still keyed by source |
| F8 | pi-resources-view (MODIFIED): Read-only skill row | EP | L1 | automated | scan result with managed-by-Claude skill + normal package skill | render Resources surface | Claude skill row shows "managed by Claude plugin x", no toggle; normal row has toggle |
| F9 | runtime: Busy command via dashboard queue | state-transition | L3 | automated | harness session streaming (long fake turn); `cmds` installed; 1 typed follow-up queued | send `/cmds:review 42` from dashboard | queue chip shows typed entry then command expansion (order preserved); after settle both delivered in order |
| F10 | runtime: Dashboard prompt blocked | state-transition | L3 | automated | `hooks` plugin whose UserPromptSubmit exits 2 on text containing `secret` | send `my secret` from dashboard | notification shows reason; agent receives no turn (no assistant message within 10 s); session remains idle |
| F11 | package-browse: Visual polish of consent dialog | visual/subjective | — | manual-only | consent for a 6-component plugin | human review | [judgment: dialog readable, warnings scannable — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | sources: Refresh failure | fault-injection (abort) | L1 | automated | FX-GIT remote deleted | refresh | error with reason; previous catalogue served; `marketplaces.json` unchanged |
| X2 | sources: Git timeout (refresh) | fault-injection (delay) | L1 | automated | stalled remote stub (no bytes); fake clock / timeout injected = 120 s | refresh | aborted at 120 s (not before 119 s with fake clock); reported `timed out` naming location; temp checkout dir absent; previous catalogue kept |
| X3 | sources: Git timeout (inspect) | fault-injection (delay) | L1 | automated | stalled remote | inspect | `timed out`; no consent payload; `staging/<id>` absent |
| X4 | import: Staging sweep | fault-injection (crash) | L1 | automated | `staging/a` mtime now-61 min, `staging/b` now-59 min | server boot | `a` deleted, `b` kept |
| X5 | import: Adopted payload gone | fault-injection (abort) | L1 | automated | content-only adopted plugin; its `installPath` dir deleted / entry removed from `installed_plugins.json` | session_start | plugin registers nothing; exactly one notify naming plugin; session starts |
| X6 | runtime: PreToolUse block | fault-injection (abort) | L1 | automated | Bash guard exits 2, stderr `rm is forbidden` | tool_call bash `rm x` | `{block:true, reason:"rm is forbidden"}` |
| X7 | runtime: PreToolUse timeout & crash | fault-injection (delay/abort) | L1 | automated | hook `sleep 5` with `timeout: 1`; hook exits 1 with garbage stdout | tool_call | timeout → block with timeout reason at ~1 s; crash → block |
| X8 | runtime: Missing interpreter | fault-injection (abort) | L1 | automated | no-matcher PreToolUse `python3 hook.py`, PATH without python3 | session_start; two tool calls | one degraded notify per session; both calls blocked, reason names `python3` and plugin |
| X9 | runtime: Non-blocking hook failure | fault-injection (abort) | L1 | automated | PostToolUse exits 1; Stop outputs `{decision:"block"}` | tool_result; agent_settled | result unchanged + warning; Stop ignored + warning; run ends |
| X10 | runtime: updatedInput unmappable | fault-injection | L1 | automated | PreToolUse on Edit returns `updatedInput` with unknown field only | tool_call | blocked, reason "update could not be applied" |
| X11 | runtime: Inline command failure | fault-injection (abort/delay) | L1 | automated | `` !`exit 3` ``; `` !`sleep 40` `` (30 s timeout) | invoke | placeholder → marked note with status 3; timeout note at 30 s; message still sent |
| X12 | import: Install via real session (harness) | fault-injection (abort) | L3 | automated | harness: install `hooks` plugin globally; its runtime file deleted afterwards | start new session | session card becomes active; one error notification naming plugin; no hook runs (bash `rm x` not blocked) |
| X13 | import: Package op busy | fault-injection (contention) | L1 | automated | package queue running another install | install Claude plugin | 409 busy from existing single-flight path; no overlay/staging left behind |

---

## Coverage summary

- **Requirements covered:** 53/53 across 8 delta specs. Every ADDED/MODIFIED requirement maps to at least one row; the hooks section maps to E38–E45 and X6–X10.
- **Scenarios by class:** edge 53 · perf 0 (no budget, by decision) · frontend 11 · error 13.
- **Scenarios by level:** L1 70 · L2 0 · L3 6.
- **Scenarios by disposition:** automated 76 · manual-only 1.

## New infra needed

- **L1 fixtures (test data only, no new harness):**
  - `FX-MKT`, `FX-GIT` (bare repos via `file://`), `FX-CLAUDE` (HOME-redirected fake `~/.claude/plugins`);
  - a stalled-git-remote stub (local TCP server that accepts and never responds), for X2/X3;
  - a fake `pi` ExtensionAPI double with per-extension API objects sharing a session id (E29, E30, E44).
- **L3:** mount FX-MKT and FX-CLAUDE into the docker harness (seed via `PI_E2E_SEED` path or a volume), plus a fake long-running turn for F9. This extends the existing harness; no new harness.
