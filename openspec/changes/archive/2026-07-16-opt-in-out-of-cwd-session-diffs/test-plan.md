# Test Plan — opt-in-out-of-cwd-session-diffs

Stage: design   Generated: 2026-07-15

All Triples resolved concretely (large-render cap + fetch-fail observable clarified). No open clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | out-of-cwd carried, payload-only | EP | L1 | automated | session events with Write to `/tmp/mockup/index.html`, cwd `/repo` | `buildSessionDiff(events, cwd)` | `data.files` has an entry keyed `/tmp/mockup/index.html` with `changes[]`; `gitDiff` undefined |
| E2 | in-cwd unchanged (regression) | EP | L1 | automated | Write to `src/a.ts` in a git cwd | `buildSessionDiff` | entry keyed relative `src/a.ts`, retains existing git/synthetic enrichment |
| E3 | guard-before-enrichment (SECURITY) | boundary | L1 | automated | cwd `/repo/packages/server`, Write to `/repo/.env` (out-of-cwd, under repo, untracked); spy on `fs.readFileSync`/git runner | `buildSessionDiff` | zero `readFileSync(resolve(cwd,path))` and zero `git` calls for `/repo/.env`; entry has no `gitDiff` |
| E4 | on-demand full content | EP | L1 | automated | JSONL with a Write of a 7 KB file (in-memory event truncated at 4 KB) | GET full-payload endpoint `(sessionId, toolCallId)` | returns the untruncated 7 KB `content` (no `…[truncated]` marker) |
| E5 | on-demand full edits (>20 ops) | BVA | L1 | automated | Edit with 21 ops (in-memory `edits` collapsed to `"[array truncated]"`); JSONL intact | GET endpoint `(sessionId, toolCallId)` | returns the full 21-element `edits` array |
| E6 | endpoint miss reads nothing | EP | L1 | automated | valid sessionId, unknown `toolCallId`; spy on fs | GET endpoint | not-found result; no file read; no path constructed from sessionId |
| E7 | no path input / no traversal (SECURITY) | boundary | L1 | automated | sessionId containing `../` or a path-looking `toolCallId` | GET endpoint | resolves only via `sessionManager.get(sessionId).sessionFile`; reads nothing outside that transcript |
| E8 | preference default off | EP | L1 | automated | fresh preferences store | read `showOutOfCwdSessionDiffs` | value is `false` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | pref off suppresses row | state | L3 | automated | session wrote `/tmp/mockup/index.html`; pref off | render change-summary block | out-of-cwd file NOT listed; no `diff:` tab openable for it |
| F2 | pref on renders payload diff | state | L3 | automated | same; pref on | click the out-of-cwd row | `diff:`-viewer tab opens; renders diff from `change.content` (not the empty "No changes" state) |
| F3 | large payload upgrades, no cap | convergence | L3 | automated | out-of-cwd Write of a 1 MB file (in-memory truncated); pref on | open the diff tab | viewer lazy-fetches full payload; diff converges to the complete 1 MB content, no size cap |
| F4 | absolute key does not corrupt tree | state | L3 | automated | `data.files` mixing `/tmp/mockup/index.html` (abs) + `src/a.ts` (rel) | render the changed-files tree | no blank-root (`""`) node; out-of-cwd entry appears in its own "outside workspace" grouping |
| F5 | file-content toggle hidden out-of-cwd | decision-table | L3 | automated | out-of-cwd diff tab, `previewable:false` | render the diff viewer toolbar | no "File" content-view toggle shown (no `/api/session-file` 403 dialog reachable) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | deleted-since-write | fault-injection (abort) | L3 | automated | out-of-cwd file written then deleted on disk; pref on | open the diff tab | "file no longer present"; server performs no read of the path |
| X2 | lazy fetch fails + truncated | fault-injection (abort) | L3 | automated | in-memory payload truncated; full-payload endpoint returns error/not-found | open the diff tab | partial (truncated) diff + "content truncated — full version unavailable" banner; never blank; no fs read |
| X3 | JSONL file missing on disk | fault-injection (abort) | L1 | automated | `sessionFile` path recorded but file deleted | GET endpoint | graceful not-found; no throw; reads nothing else |

---

## Coverage summary

- Requirements covered: session-diff carry (E1/E2), guard (E3), endpoint (E4/E5/E6/E7/X3), pref default (E8), display gate (F1/F2), fidelity (F3/X2), tree+preview (F4/F5), deleted (X1) — all spec requirements covered.
- Scenarios by class: edge 8 · perf 0 · frontend 5 · error 3
- Scenarios by level: L1 9 · L2 0 · L3 7
- Scenarios by disposition: automated 16 · manual-only 0

## New infra needed

- none — L1 vitest + L3 Playwright (docker harness, port from `.pi-test-harness.json`) already exist. No perf tier (spec carries no latency/throughput budget).
