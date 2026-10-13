# Test Plan — redesign-directory-home-split

Stage: design   Generated: 2026-10-13

Clarification resolved at the hard gate: a folder with no stored layout opens in **Split** (spec updated).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sessionless › Spawn-time model and thinking reach pi | EP (valid) | L1 | automated | `{cwd:"/p", model:"anthropic/claude-sonnet-5", thinkingLevel:"high"}` | `spawn_session` handled | `spawnPiSession` options `model:"anthropic/claude-sonnet-5"`, `thinking:"high"` |
| E2 | sessionless › Spawn-time … (multi-segment) | EP (valid) | L1 | automated | `model:"openrouter/meta-llama/llama-4"` | validator | accepted unchanged |
| E3 | sessionless › Spawn-time … (invalid partitions) | EP + BVA | L1 | automated | `"x; rm -rf /"`, `"--help/x"`, `"a/b/--x"`, `"sonnet"`, `"a/"`, `"/b"`, `"a//b"`, 201-char id, 200-char id | validator | each invalid → dropped + `console.warn`; the 200-char id accepted, the 201-char id dropped |
| E4 | sessionless › Spawn-time … (thinking enum) | EP | L1 | automated | each of `off,minimal,low,medium,high,xhigh,max` and `"turbo"`, `""`, `"HIGH"` | validator | 7 accepted; 3 dropped |
| E5 | sessionless › suffix split | decision-table | L1 | automated | (a) `model:"m/x:high"`, no `thinkingLevel`; (b) `"m/x:high"` + `thinkingLevel:"low"`; (c) `"m/x:high"` + `thinkingLevel:"bogus"`; (d) `"m/x:free"`, no level | validator | (a) model `m/x`, thinking `high`; (b) model `m/x:high`, thinking `low`; (c) model `m/x:high`, no thinking; (d) model `m/x:free`, no thinking |
| E6 | sessionless › thinking without model | decision-table | L1 | automated | config `defaultModel:"anthropic/claude-opus-5-5"`; (a) `thinkingLevel:"high"` only; (b) no config default + `thinkingLevel:"high"` | `spawn_session` handled | (a) options `model:"anthropic/claude-opus-5-5"`, `thinking:"high"`; (b) `thinking:"high"`, no model |
| E7 | sessionless › argv | EP | L1 | automated | `SessionFlags` fresh / `continue` / fork, each with `model` + `thinking` | `sessionFlagsToArgv` | fresh + `continue` contain `"--model",m` and `"--thinking",t` as discrete elements; fork output unchanged versus today |
| E8 | sessionless › argv on tmux | EP | L1 | automated | tmux strategy, valid model `"a/b@c+d"` | pane command built | the model appears as one `shellEscape`d token; an unescaped `;`/`$` never appears |
| E9 | sessionless › Folder command list › live | decision-table | L1 | automated | sessions in `/p`: A connected, list 173, received t1; B connected, list 5, received t2>t1 | GET `?cwd=/p` | origin `live`, 5 commands (B) |
| E10 | sessionless › live exclusions | decision-table | L1 | automated | (a) only session ended; (b) status active but `isSessionConnected=false` (crashed); (c) connected, empty accepted list; (d) live session only in `/p/sub` | GET `?cwd=/p` | (a), (b), (d) origin ≠ `live`; (c) origin `scan` when the scan has skills |
| E11 | sessionless › path normalization | EP | L1 | automated | live session in `/p`; request `/p/`; request `/link` → `/p` (symlink); request `/gone/` (no such dir) | GET | `/p/` → `live`; `/link` → `live`; `/gone/` → 200 with origin `none` or `scan`, no throw |
| E12 | sessionless › request validation | EP | L1 | automated | no `cwd`; `cwd=p`; `cwd=` | GET | 400 each |
| E13 | sessionless › scan mapping | EP | L1 | automated | no live session; scan: local skill `document-organizer` (enabled), global skill `xlsx` (enabled), global skill `pdf` (disabled), local-scope package skill `pkgskill`, prompt `weekly-review` | GET | contains `skill:document-organizer` (scope folder), `skill:pkgskill` (scope folder), `skill:xlsx` (scope global), `weekly-review` (source prompt); no `skill:pdf`; each `path` = the resource `filePath` |
| E14 | sessionless › scope for live entries | EP | L1 | automated | live list: entry with path under `/p/.pi/skills/`, entry with a global path, entry with no path | GET | scopes `folder`, `global`, `global` |
| E15 | sessionless › route tier | EP | L1 | automated | `ROUTE_TIERS` + `classifyHttpRoad` | lookup `GET /api/pi-resources/commands` | tier `observe`, road `packages`; the route-tier totality test passes |
| E16 | directory-home › Skill starters ordering | BVA | L1 | automated | command lists of 0, 1, 6 and 9 skills/prompts, mixed scopes | render pane | 0 → no starter row; 1 → 1 card; 6 → 6; 9 → 6; folder-scope skills, then prompts, then global skills |
| E17 | directory-home › Skill starters insert | decision-table | L1 | automated | drafts `""`, `"summarize 2025"`, `"/skill:xlsx clean"`, `"/"` | click `doc-summarizer` card | `"/skill:doc-summarizer "`, `"/skill:doc-summarizer summarize 2025"`, `"/skill:doc-summarizer clean"`, `"/skill:doc-summarizer "`; caret at end; no `spawn_session` sent |
| E18 | directory-home › Docked prompt (defaults) | decision-table | L1 | automated | (a) default model + default thinking; (b) default model, no thinking default; (c) no defaults; (d) catalogue fails + default model | render + send `"hi"` unchanged | (a) `model` + `thinkingLevel` sent, both chips tagged `default`; (b) `model` only; (c) chip `pi default`, neither sent; (d) chip shows the default model, `model` sent |
| E19 | directory-home › Run-location chip | decision-table | L1 | automated | `folderGitMap` cwd = git / not git / unknown | render | shown / hidden / hidden (send uses This folder) |
| E20 | directory-home › Empty prompt | EP | L1 | automated | `""`, `"   \n\t"` | Enter / click Start | no `spawn_session` sent |
| E21 | command-autocomplete › Commands state in App | decision-table | L1 | automated | (a) live session, no `commands_list`; (b) ended session, no `commands_list`, folder list [skill:x]; (c) ended session with a stored `commands_list` | select session | (a) `[]`; (b) `[skill:x]`; (c) the stored list |
| E22 | sessionless › Resume applies a pick | decision-table | L1 | automated | ended session (model M0, thinking high): (a) pick model M1; (b) pick thinking low; (c) both; (d) none | auto-resume via `send_prompt` | spawn options (a) model M1, thinking high (session value filled); (b) thinking low, no model; (c) M1 + low; (d) neither |
| E23 | sessionless › resume_session continue/fork | decision-table | L1 | automated | `resume_session` `continue` + model M1; `fork` + model M1 | handler | continue → options model M1; fork → no model in options or argv |
| E24 | sessionless › resume validation | EP | L1 | automated | `send_prompt` on an ended session with `model:"--help/x"` | handler | resume spawn has no model; warn logged |
| E25 | sessionless › live session ignores pick fields | EP | L1 | automated | `send_prompt` with `model` to a live (connected) session | handler | prompt forwarded to the bridge; no spawn; no `set_model` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | — | — | — | — | No latency/throughput requirement in the spec. The commands route reuses the bounded `/api/pi-resources` resolver. | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | directory-home › natural height (#877) | layout invariant | L3 | automated | `/folder/<cwd>` at 1440×900 and 768×900, empty draft | page load | `composer-card` `scrollHeight <= clientHeight`; Start button bounding box fully inside the card and the viewport; no `border-top` on the composer root's previous sibling region |
| F2 | directory-home › Folder home hosts the editor split | state-transition | L3 | automated | fresh harness, no stored layout for cwd | load → click Editor → click peek → click Chat → reload | Split (both panes) → editor only + peek → Split → chat only + peek → after reload, Chat persists |
| F3 | directory-home › New terminal from pane | state-transition | L3 | automated | Split mode | click the pane's new-terminal | a `term:` tab becomes active, cwd = folder |
| F4 | directory-home › Folder home content | state | L3 | automated | folder with ≥2 sessions | page load | no `directory-home-session-list`; no `directory-home-open-*`; header gear present; `LandingPage` absent |
| F5 | directory-home › Settings from header | transition | L3 | automated | page loaded | click the header gear | URL = `/folder/<encoded>/settings` |
| F6 | directory-home › Docked prompt spawns + navigate | async convergence | L3 | automated | type `"say hi"`, keep defaults | press Enter | Start disabled immediately; converges to URL `/session/<newId>`; that session's first user message = `"say hi"` |
| F7 | directory-home › double send | race | L1 | automated | in-flight spawn (no `session_added` yet) | Enter twice + click Start | exactly one `spawn_session` sent |
| F8 | directory-home › Failed spawn re-enables | state-transition | L1 | automated | in-flight `requestId` R | `spawn_result {success:false, requestId:R}`; separately `spawn_register_timeout {requestId:R}`; separately one for another id R2 | R → Start enabled, draft kept; R2 → still disabled |
| F9 | directory-home › page does not navigate itself | invariant | L1 | automated | spawn correlates | `session_added {spawnRequestId:R}` | `navigate` called once (by App), not by the page |
| F10 | directory-home › worktree flow | state-transition | L1 | automated | git cwd, draft `"x"`, model M | New worktree… → `onSpawnStart` → `onSpawn("/wt", {gitWorktreeBase:"develop"})` | exactly 1 `spawn_session {cwd:"/wt", initialPrompt:"x", model:M, gitWorktreeBase:"develop", requestId}` |
| F11 | directory-home › worktree abort | state-transition | L1 | automated | as F10 | `onSpawnAbort` | Start enabled, draft `"x"` kept, no `spawn_session` |
| F12 | sessionless › ended composer has skills | async convergence | L3 | automated | an ended session in a cwd with skill `doc-summarizer`, no live sessions there | open the session, type `/` | popover lists `skill:doc-summarizer` and shows the "from disk" hint |
| F13 | sessionless › model chip on ended session | state | L1 | automated | ended session, `model:"anthropic/claude-opus-5-5"` | render | the chip reads that model |
| F14 | sessionless › no empty flash on resume | state-convergence | L1 | automated | ended session showing folder list [skill:x] | status → active, `commands_list` not yet received; then received [skill:y] | the list is never `[]`: [skill:x] → [skill:y] |
| F15 | sessionless › pick clearing | state-transition | L1 | automated | ended session with pick M1 | (a) session registers live; (b) separately `set_model` for it | pick cleared; the next resume sends no model |
| F16 | sessionless › chip shows pick | state | L1 | automated | ended session, model M0, pick M1 | render | the chip reads M1 |
| F17 | directory-home › First visit opens Split | state | L1 | automated | no stored layout for `folderPaneId(cwd)` | render | mode `split` |
| F18 | starter insert uses current onDraftChange | stale-closure | L1 | automated | rerender with a new `onDraftChange` v2 | click a card | v2 called, v1 not |
| F19 | visual parity with mockup | visual/subjective | — | manual-only | `/folder/<cwd>` in base dark, base light, one non-base palette, at 1440/768/375 | human compares with `mockups/directory-home-split/index.html` | [judgment: hierarchy, spacing and chip density match the mockup] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | sessionless › Unsupported server | fault-injection (abort) | L1 | automated | commands route → 404 | `useFolderCommands("/p")` | resolves `[]`, no thrown error, no retry loop (≤1 request per cwd change) |
| X2 | sessionless › route failure | fault-injection (abort) | L1 | automated | route → 500 / network error | hook | `[]`; composer still usable |
| X3 | sessionless › catalogue failure | fault-injection (abort) | L1 | automated | `fetchModelCatalogue` → `{status:"unavailable"}`, no default model | send from folder home | spawn sent without `model`; chip `pi default` |
| X4 | sessionless › scan resolver degraded | fault-injection | L1 | automated | `/api/pi-resources` scan returns `degraded:true` | GET commands | origin `scan`, list from the fallback, 200 |
| X5 | sessionless › picks do not cross sessions | race | L1 | automated | ended A (pick M1) and B (no pick) in `/p` | both `send_prompt` concurrently | A spawn options model M1; B options no model |
| X6 | sessionless › second pick while resuming | race | L1 | automated | ended A resuming (`alreadyResuming`) | second `send_prompt` with model M2 | no second spawn; the M2 pick is not applied |
| X7 | directory-home › old server | fault-injection | L1 | automated | server ignores `model` | spawn | the client still navigates on `session_added`; no error surfaced |

---

## Coverage summary

- Requirements covered:
  - `directory-home-page`: Bare route (F4), Docked prompt (E18–E20, F1, F6–F11), Folder home content (F4, F5), Split (F2, F3, F17), Starters (E16, E17, F18).
  - `sessionless-composer-context`: all 6 requirements (E1–E15, E22–E25, F12–F16, X1–X7).
  - `command-autocomplete`: Commands state (E21).
  - Total: 13/13.
- Scenarios by class: edge 25 · perf 0 · frontend 19 · error 7
- Scenarios by level: L1 43 · L2 0 · L3 7
- Scenarios by disposition: automated 50 · manual-only 1

## New infra needed

- none (L3 rows run on the existing docker harness; F12 needs an ended session fixture, which the existing `tests/e2e` session fixtures can produce by spawning then ending a session).
