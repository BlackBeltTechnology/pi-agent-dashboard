# Test Plan: add-spawn-model-choice

Stage: design (hard gate). Generated: 2026-10-13

The gate surfaced one gap, C1: how a remembered folder choice is cleared. The user resolved it: a `default` entry in the chip clears that field. It is folded into `worktree-spawn-dialog` and `acp-agent-sessions`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | spawn-model-choice: resolver / role resolved | decision-table | L1 | automated | roles `{planning:"anthropic/claude-opus-5-5:high"}` | `resolveSpawnChoice({model:"@planning"})` | `{choice:{model:"anthropic/claude-opus-5-5", thinking:"high"}, warnings:[]}` |
| E2 | spawn-model-choice: precedence (field > role) | decision-table | L1 | automated | same roles | `resolveSpawnChoice({model:"@planning", thinkingLevel:"low"})` | model `anthropic/claude-opus-5-5` (no `:high` suffix), thinking `low` |
| E3 | spawn-model-choice: precedence (suffix > role) | decision-table | L1 | automated | same roles | `resolveSpawnChoice({model:"@planning:medium"})` | model `anthropic/claude-opus-5-5`, thinking `medium` |
| E4 | sessionless-composer-context: literal rule kept | decision-table | L1 | automated | no roles read | `resolveSpawnChoice({model:"anthropic/x:high", thinkingLevel:"low"})` | model `anthropic/x:high`, thinking `low` (today's suffix rule unchanged) |
| E5 | spawn-model-choice: literal ref reads no roles file | EP | L1 | automated | `readRoles` spy | `resolveSpawnChoice({model:"openai/gpt-6"})` | spy called 0 times; for `@fast` called exactly 1 time |
| E6 | spawn-model-choice: thinking-only pairing | decision-table | L1 | automated | `defaultModel:"anthropic/claude-sonnet-5-5"`; then `defaultModel` unset | `resolveSpawnChoice({thinkingLevel:"high"})` | with default → model `anthropic/claude-sonnet-5-5` + `high`; without default → thinking `high`, no model |
| E7 | spawn-model-choice: unresolvable role | EP | L1 | automated | roles `{}` | `resolveSpawnChoice({model:"@ghost"})` | empty choice, `warnings` contains `ghost` |
| E8 | spawn-model-choice: ACP warning only with a choice | decision-table | L1 | automated | `agent:"qmt"` with / without `model` | `resolveSpawnChoice({agent:"qmt", model:"openai/gpt-6"})` vs `{agent:"qmt"}` | first → empty choice + 1 warning; second → empty choice, 0 warnings |
| E9 | spawn-model-choice: role assigned an invalid ref | BVA | L1 | automated | roles `{bad:"--help/x"}` | `resolveSpawnChoice({model:"@bad"})` | model dropped, warning present (argv safety holds for role values) |
| E10 | dashboard-server: REST role spawn | EP | L1 | automated | roles `{fast:"anthropic/claude-haiku-5-5"}`, `spawnPiSession` mocked | `POST /api/session/spawn {cwd:"/p", model:"@fast"}` | 200 `success:true`; `spawnPiSession` called with `model:"anthropic/claude-haiku-5-5"` |
| E11 | dashboard-server: REST 400 matrix | decision-table + BVA | L1 | automated | bodies: `model:"@ghost"`, `thinkingLevel:"turbo"`, `model:123`, `initialPrompt:{}`, `agent:"qmt"+model`, `agent:"qmt"+thinkingLevel` | `POST /api/session/spawn` each | each 400 with error text; `spawnPiSession` never called; owner registry `file` never called; both pending registries `size("/p")===0` |
| E12 | dashboard-server: empty string = absent | BVA | L1 | automated | `{cwd:"/p", model:"", initialPrompt:""}` | `POST /api/session/spawn` | 200; spawned without `--model`; nothing queued |
| E13 | dashboard-server: legacy body | EP | L1 | automated | `{cwd:"/p"}` | `POST /api/session/spawn` | 200; `spawnPiSession` options carry no `model`/`thinking` (byte-identical to pre-change call) |
| E14 | dashboard-server: initialPrompt + attach on register | state-transition | L1 | automated | `{cwd:"/p", initialPrompt:"hello", attachProposal:"my-change"}` | REST spawn succeeds | `pendingInitialPromptRegistry.consume("/p")==="hello"`, `pendingAttachRegistry.consume("/p")==="my-change"` |
| E15 | plugin-spawn-scope: role + level | decision-table | L1 | automated | roles `{review:"zai/glm-5.3"}` | hook `spawnSession({cwd:"/p", model:"@review", thinkingLevel:"low"})` | `spawnPiSession` gets `model:"zai/glm-5.3"`, `thinking:"low"` |
| E16 | plugin-spawn-scope: literal pass-through | EP | L1 | automated | — | hook `spawnSession({cwd:"/p", model:"sonnet"})` | `spawnPiSession` gets `model:"sonnet"`; no `warning` |
| E17 | plugin-spawn-scope: unresolvable role | EP | L1 | automated | roles `{}` | hook `spawnSession({cwd:"/p", model:"@ghost"})` | spawned without model; result `warning` names `ghost` |
| E18 | plugin-spawn-scope: agent + thinkingLevel | decision-table | L1 | automated | `acpAgents:[{id:"qmt"}]` | hook `spawnSession({cwd:"/p", agent:"qmt", thinkingLevel:"low"})` | `success:false`, message lists `thinkingLevel` as pi-only; no spawn |
| E19 | plugin-spawn-scope: no model unchanged | EP | L1 | automated | — | hook `spawnSession({cwd:"/p"})` | `spawnPiSession` options have no `model`/`thinking` |
| E20 | dashboard-mcp-server: forwards full input | EP | L1 | automated | ctx.spawnSession spy | MCP `spawn_session {cwd:"/p", agent:"qmt"}` and `{cwd:"/p", model:"@review", initialPrompt:"go"}` | spy receives `agent:"qmt"`; second receives `model:"@review"`, `initialPrompt:"go"` |
| E21 | dashboard-mcp-server: generated schema fresh | EP | L1 | automated | widened `SpawnSessionRequest` | regenerate in memory (freshness test) | `spawn_session.inputSchema.properties` has `cwd, agent, model, thinkingLevel, initialPrompt`; no `attachProposal`; equals committed file |
| E22 | dashboard-mcp-server: warning in tool result | EP | L1 | automated | hook returns `{success:true, warning:"role 'ghost' not configured yet"}` | MCP `spawn_session {cwd:"/p", model:"@ghost"}` | tool result text contains `role 'ghost' not configured yet` |
| E23 | dashboard-bus-client: fields sent | EP | L1 | automated | mock server | `client.spawn({cwd:"/p", model:"@planning", thinkingLevel:"high"})` | recorded `spawn_session` frame has `model:"@planning"`, `thinkingLevel:"high"` |
| E24 | dashboard-bus-client: onWarning | state-transition | L1 | automated | mock answers `spawn_result {success:true, choiceWarning:"w"}` then `session_added` | `client.spawn({cwd:"/p", model:"@ghost", onWarning})` | resolves with session id string; `onWarning` called once with `"w"` |
| E25 | dashboard-bus-client: CLI flags | EP | L1 | automated | mock bus | `dashboard-bus.ts spawn /p --model @ghost --thinking low` (argv parse) | `client.spawn` called with `model:"@ghost"`, `thinkingLevel:"low"`; stdout has `spawned <id>` and `warning: <text>` |
| E26 | shared-protocol: choiceWarning type | EP | L1 | automated | TS fixture | type-check `SpawnResultBrowserMessage` with / without `choiceWarning` | compiles; WS legacy spawn result has no `choiceWarning` key |
| E27 | spawn-model-choice: bridge inherits | EP | L1 | automated | bridge ctx model `anthropic/claude-sonnet-5-5`, thinking `medium` | `spawnNew()` | sent frame `{type:"spawn_new_session", sessionId, cwd, model:"anthropic/claude-sonnet-5-5", thinkingLevel:"medium"}` |
| E28 | spawn-model-choice: bridge unknown model | EP | L1 | automated | no cached ctx (`getCurrentModelString` → undefined) | `spawnNew()` | sent frame has no `model`/`thinkingLevel` keys |
| E29 | spawn-model-choice: server bridge road | EP | L1 | automated | `spawn_new_session {cwd:"/p", model:"anthropic/claude-sonnet-5-5", thinkingLevel:"medium"}` | event-wiring handles message | `spawnPiSession("/p", {model, thinking})` called |
| E30 | worktree-spawn-dialog: create-new carries pick | EP | L1 | automated | dialog `cwd="/repo"`, models fixture | pick `anthropic/claude-opus-5-5` + `high`, submit create | `onSpawn(path, {gitWorktreeBase, model:"anthropic/claude-opus-5-5", thinkingLevel:"high"})` |
| E31 | worktree-spawn-dialog: existing row carries role | EP | L1 | automated | `/api/roles` mocked with `planning` | pick `@planning`, click existing worktree row | `onSpawn(entry.path, {model:"@planning"})` |
| E32 | worktree-spawn-dialog: preselect from memory / default | decision-table | L1 | automated | localStorage `pi-dashboard:spawn-choice:/repo={model:"@review"}`; then empty + Settings default `anthropic/claude-sonnet-5-5` | dialog mounts | chip shows `@review`; second case shows `anthropic/claude-sonnet-5-5` with `default` tag |
| E33 | worktree-spawn-dialog: default entry clears field | state-transition | L1 | automated | memory `{model:"@review", thinkingLevel:"high"}`, default `anthropic/claude-sonnet-5-5` | choose model `default` entry | memory `{thinkingLevel:"high"}` (no model); chip shows `anthropic/claude-sonnet-5-5` tagged `default` |
| E34 | worktree-spawn-dialog: hidden mode | EP | L1 | automated | `modelChoice="hidden"` | render + spawn existing row | no element with the chip test id; `onSpawn` opts have no `model`/`thinkingLevel` |
| E35 | worktree-spawn-dialog: ACP disables chip | decision-table | L1 | automated | `acpAgents:[qmt]`, memory model `@fast` | select agent `qmt`, spawn | chip `aria-disabled`/disabled; `onSpawn` opts `{agent:"qmt"}` without model |
| E36 | spawn-choice-memory: storage unavailable | fault-injection (abort) | L1 | automated | `localStorage.getItem/setItem` throw | `getEffectiveSpawnChoice("/a", defaults)` + `set` | returns defaults; no throw |
| E37 | spawn-choice-memory: per-field fallback | decision-table | L1 | automated | memory `{thinkingLevel:"low"}`, defaults `{model:"m/x", thinkingLevel:"high"}` | `getEffectiveSpawnChoice` | `{model:"m/x", thinkingLevel:"low"}` |
| E38 | acp-agent-sessions: no-agent menu has only model chip | EP | L1 | automated | `acpAgents:[]` | open `AgentSpawnPicker` chevron | menu has the model chip; no agent radio items |
| E39 | acp-agent-sessions: main button uses memory, pick doesn't spawn | state-transition | L1 | automated | memory `@fast` | pick `@review` in menu → `onSpawn` not called; click main button | `onSpawn(undefined, {model:"@review"})` once, after the main click only |
| E40 | acp-agent-sessions: remembered ACP wins | decision-table | L1 | automated | agent memory `qmt`, choice memory `@fast` | main button click; `useAgentAwareSpawn`-wrapped board spawn | both send `agent:"qmt"` with no `model`/`thinkingLevel` |
| E41 | acp-agent-sessions: board uses remembered choice | EP | L1 | automated | choice memory `@fast`, no agent | `useAgentAwareSpawn(spawn)("/a", "chg", {focus:false})` | inner spawn receives `{focus:false, model:"@fast"}` |
| E42 | acp-agent-sessions: Initialize, all three paths | EP | L1 | automated | memory `@fast`, agent memory `qmt` | trigger the "Project setup…" menu item (`SessionList:1923`) and both banner Initialize buttons | each `onSpawnSession(cwd, undefined, {initialPrompt, model:"@fast"})`, no `agent` |
| E43 | session-card-subcards: sibling inherits | decision-table | L1 | automated | parent pi `{model:"anthropic/claude-opus-5-5", thinkingLevel:"high"}`; parent with `model:""`; ACP parent | activate `session-card-spawn-sibling` | first → `model`+`thinkingLevel` present; second → no `model` key; ACP → `agent` only |
| E44 | acp-agent-sessions: keyboard sibling shortcut inherits | EP | L1 | automated | selected pi session with model/thinking | fire the App sibling shortcut handler (`App.tsx:1993`) | `handleSpawnSession` opts carry the source `model`/`thinkingLevel` |
| E45 | directory-home-page: ACP drops composer model | decision-table | L1 | automated | Settings default model set, agent `qmt` selected | send prompt from the home composer | `onSpawnSession` opts have `agent:"qmt"` and no `model`/`thinkingLevel` |
| E46 | pi-dashboard-skill: docs cover the choice | EP | L1 | automated | skill files | content test reads `commands/dashboard-session-spawn.md`, `references/api-reference.md`, `references/recipes.md`, claude-plugin `pi-dashboard-control` mirror | usage has `--model` and `--thinking`; API ref lists `model`, `thinkingLevel`, `initialPrompt`, `attachProposal` and `400`; recipes contain no `{ sessionId } = await bus.spawn` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | acp-agent-sessions: APG keyboard on always-on chevron | state-transition | L1 | automated | `acpAgents:[]` | focus chevron → ArrowDown/Escape | menu opens on Enter/ArrowDown, Escape closes and focus returns to chevron |
| F2 | spawn-model-choice: browser warning toast | state-convergence | L1 | automated | `spawn_result {success:true, choiceWarning:"role 'ghost' not configured yet"}` | `useMessageHandler` handles it | warning toast with that text rendered once; pending spawn NOT marked failed |
| F3 | worktree-spawn-dialog + server: end-to-end worktree spawn on a role | state-convergence | L3 | automated | docker harness, roles `{fast:<faux model>}` in harness providers.json, git repo folder | open folder worktree dialog, pick `@fast`, create worktree | new session card converges with model = the role's concrete model (session `model` field / chip text) |
| F4 | acp-agent-sessions: folder split button end-to-end | state-convergence | L3 | automated | docker harness, no ACP agents | open the New Session chevron, pick a model, close, click New Session | spawned session's model equals the pick; chevron menu reachable by keyboard |
| F5 | worktree-spawn-dialog + folder menu: chip visual fit | visual/subjective | — | manual-only | dialog + folder menu at 375px and desktop | human looks | chip, Role tab and `default` entries legible, no clipping, matches the adopted mockup |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | dashboard-server: failed spawn withdraws only its own intents | fault-injection (abort) | L1 | automated | `spawnPiSession` resolves `{success:false}`; queue pre-seeded with prompt `A` for `/p` | REST spawn `{cwd:"/p", initialPrompt:"B"}` | 500; queue for `/p` = `["A"]` |
| X2 | registries: withdraw semantics | BVA | L1 | automated | queue `["A","B","A"]` | `withdraw("/p","A")` then `withdraw("/p","Z")` | queue `["A","B"]`, returns true; second returns false, queue unchanged |
| X3 | WS spawn failure withdraws intents | fault-injection (abort) | L1 | automated | WS spawn with `initialPrompt:"B"`, `attachProposal:"c"`; spawn fails; queue pre-seeded `A` | `handleSpawnSession` | `spawn_result.success:false`; prompt queue `["A"]`; attach queue has no `c` |
| X4 | spawn-model-choice: WS unknown role | fault-injection (abort) | L1 | automated | roles file has no `ghost` | WS `spawn_session {cwd:"/p", model:"@ghost"}` | spawned without `--model`; `spawn_result {success:true, choiceWarning}` containing `ghost`; `console.warn` once |
| X5 | spawn-model-choice: roles file garbled | fault-injection (abort) | L1 | automated | `providers.json` = `{not json` | WS `spawn_session {model:"@fast"}` | no throw; spawn proceeds without model; `choiceWarning` present |
| X6 | spawn-model-choice: WS ACP + model | decision-table | L1 | automated | `acpAgents:[qmt]` | WS `spawn_session {cwd:"/p", agent:"qmt", model:"openai/gpt-6"}` | ACP spawn called; `spawn_result.choiceWarning` present |
| X7 | spawn-model-choice: bridge context throws | fault-injection (abort) | L1 | automated | `syncBc` / `getCurrentModelString` throws | `spawnNew()` | still sends `{type:"spawn_new_session", sessionId, cwd}`; no throw escapes |

---

## Coverage summary

- Requirements covered: 18/18 (every ADDED/MODIFIED requirement across 12 delta capabilities has ≥1 row)
- Scenarios by class: edge 46 · perf 0 · frontend 5 · error 7
- Scenarios by level: L1 55 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 57 · manual-only 1
- Performance: none. No latency requirement exists; the only perf-shaped rule (roles file read only for `@` refs) is E5.

## New infra needed

- F3 needs a role assigned to the harness faux model in the docker harness `providers.json`. Extend the existing harness seed (see `tests/e2e/session-spawn.spec.ts` / `directory-home.spec.ts` for the faux-model setup); otherwise none.
