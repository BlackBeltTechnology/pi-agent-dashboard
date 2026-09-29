# Test Plan — update-pi-core-0-99-adopt-apis

Stage: design   Generated: 2026-09-30

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-core-version-check: lockstep floor | BVA | L1 | automated | `piCompatibility` = min `0.99.1`, rec `0.99.1`, running `0.99.0` / `0.99.1` / `1.0.0` | `computeCompatibility()` | `0.99.0` → `error` naming `0.99.0` and `0.99.1`; `0.99.1` → no error, no hint; `1.0.0` → no error (max `null`) |
| E2 | pi-core-version-check: publishable peers follow the floor | decision-table | L1 | automated | root + every `packages/*/package.json` | dependency-declarations check | every `@earendil-works` pi peer is `>=0.99.1`, optional, no upper bound; a fixture with `>=0.80.10` or `<0.87.0` fails naming the manifest |
| E3 | pi-core-version-check: broad devDependency rejected | EP | L1 | automated | fixture manifest with devDependency `@earendil-works/pi-tui: ">=0.80.10"` | dependency-declarations check | fails naming that manifest |
| E4 | release-deps checker: coherence | decision-table | L1 | automated | governed pins all `0.99.1`; then one drifted (pi-tui override `0.98.0`; a peer lower bound `0.86.1`; `minimum` `0.86.1`) | `verify-release-deps.mjs` | coherent → pass; each drift → fail naming exactly the drifted location |
| E5 | below-floor session flagged | BVA | L1 | automated | minimum `0.99.1`; reported `piVersion` `0.87.1` / `0.99.1` / undefined / `"dev"` | server session update on `pi_version_update` | flag set only for `0.87.1` |
| E6 | reported version is the running pi | EP | L1 | automated | `process.argv[1]` walks up to manifest `0.87.1`; a `0.99.1` copy resolvable by name | `sendPiVersionIfChanged()` | sends `0.87.1` |
| E7 | slash dispatch without gate | state-transition | L1 | automated | extension command `/ctx-stats`; version reader stubbed to throw if called | `tryDispatchExtensionCommand(..., "followUp")` | `sendUserMessage("/ctx-stats", {expandPromptTemplates:true, deliverAs:"followUp"})`; feedback `started` then `completed`; reader never called; no "requires pi" text |
| E8 | reload dispatch without gate | state-transition | L1 | automated | terminal-hosted bridge; version reader stubbed to throw | forwarded `/reload` | bridge self-dispatches `/__dashboard_reload <token>`; no "minimum pi version" error |
| E9 | factory generation only | EP | L1 | automated | module fakes: factory; legacy-only; partial factory | `adaptPiAi()` | factory adapted; legacy → error naming unsupported legacy pi-ai; partial → error naming missing members |
| E10 | OAuth registry on 0.99.1 | EP | L1 | automated | installed pi 0.99.1 providers | build registry | ids exactly `anthropic, openai, openai-codex, github-copilot, openrouter, kimi-coding, meta, xai`; `openai.flowType` `auth_code`; no `radius` |
| E11 | built-in settings preserved | EP | L1 | automated | settings `extensions: ["-builtin:mcp", "foo"]`, `defaultTools: ["+codemode"]` | dashboard settings write (toggle `foo`) | written file keeps `-builtin:mcp` and `defaultTools: ["+codemode"]` |
| E12 | 0.87 shapes tolerated | EP | L1 | automated | session JSONL with `context_edit` (`replacement: null`) targeting a user message; an `agent_before_settle` event | replay; status extraction | targeted message still rendered, no throw; status not idle on `agent_before_settle` |
| E13 | late-discovered in-scope model published | state-transition | L1 | automated | `enabledModels: ["myprovider/*"]`; `myprovider` models registered after session start | `onProviderChanged` model-list push | pushed list includes the new `myprovider` models |
| E14 | thinking max stays fail-closed | decision-table | L1 | automated | model with `thinkingLevelMap.max` set; runtime without `max` | model-list push | published levels exclude `max` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | below-floor warning rendered | state-transition | L1 | automated | session record with below-floor flag, `piVersion: "0.87.1"`, minimum `0.99.1` | render session card + chat | warning names `0.87.1` and `0.99.1`; absent when the flag is cleared |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session file not yet created | fault-injection (missing file) | L1 | automated | `getSessionFile()` returns a path that does not exist | session register + state sync | register succeeds with cwd/model; no error logged |
| X2 | sign in with ChatGPT | manual | — | manual-only | real ChatGPT account | providers page → Sign in (openai) | [judgment: browser flow completes and credential appears — needs a real account] |
| X3 | user-launched old pi | manual | — | manual-only | global pi 0.87.x in a terminal with the bridge installed | open the dashboard | [judgment: warning visible and legible on card + chat] |

---

## Coverage summary

- Requirements covered: 16/16
- Scenarios by class: edge 14 · perf 0 · frontend 1 · error 3
- Scenarios by level: L1 16 · L2 0 · L3 0
- Scenarios by disposition: automated 16 · manual-only 2

## New infra needed

- none
