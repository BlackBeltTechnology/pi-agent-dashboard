# Test Plan — yolo-covers-agent-path-gate

Stage: design   Generated: 2026-10-06

Hard gate passed: no unfillable Triple (budget 1500 ms, suppression 120 s, reason strings, frame shapes pinned in design.md D1–D9).

Harness exemplars: server access `packages/server/src/access/__tests__/yolo.test.ts`, `agent-grant.test.ts`, `canonical-subject.test.ts`; routes `packages/server/src/__tests__/access-prompt-routes.test.ts`; bridge `packages/extension/src/path-gate/__tests__/handler.test.ts`, `grant-link.test.ts`; move `packages/extension/src/__tests__/session-move.test.ts`; client `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`, `packages/client/src/components/settings/__tests__/AccessPromptsSection.test.tsx`; e2e `tests/e2e/agent-path-gate.spec.ts` (faux `tool-read-outside`, `tool-read-outside-grantable`), `tests/e2e/access-grant-dialog.spec.ts` (YOLO activation/cleanup via `/api/access/yolo`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | apc: YOLO answers prompt / ayolo: planes+gate | EP | L1 | automated | unscoped operator session; abs path `<tmpdir>/outside/f.txt` (non-sensitive, not system dir) | `decideAgentPath({path, hostGateMode:"enforce"})` | returns `"auto-allow"`; `counters().autoAllowed` +1; last `history()` entry `{plane:"agent-path", outcome:"auto-allowed"}` |
| E2 | ayolo: bounded by roots | EP | L1 | automated | session scoped to root `R`; path `<sibling of R>/f.txt` | `decideAgentPath` | returns `null`; no history entry; `autoAllowed` unchanged |
| E3 | ayolo ADDED: not-yet-existing subjects (gate) | BVA (existence boundary) | L1 | automated | root `R` exists; `R/data/new.json` and `R/data` do not exist | `decideAgentPath` | `"auto-allow"` |
| E4 | ayolo ADDED: not-yet-existing subjects (planes) | BVA | L1 | automated | root `R`; filesystem plane held+eligible; subject `R/new.json` absent; request holds capability | `decide({plane, subject})` | `"auto-allow"` (previously `null`) |
| E5 | ayolo ADDED: symlinked ancestor | EP (invalid) | L1 | automated | root `R`; `R/link` → dir outside `R`; `R/link/new.conf` absent | `decideAgentPath` | `null` |
| E6 | ayolo: forbidden rule (sensitive descendant) | EP (invalid) | L1 | automated | unscoped; injected home `H`; path `H/.pi/agent/x.json` | `decideAgentPath` | `null` |
| E7 | ayolo ADDED: system-dir exclusion | EP (invalid) | L1 | automated | unscoped; path `/etc/cron.d/job` (POSIX) | `decideAgentPath` | `null`; no history entry |
| E8 | ayolo ADDED: temp exemption | EP | L1 | automated | unscoped; path `realpath(os.tmpdir())/yolo-new-<rand>.txt` (absent) | `decideAgentPath` | `"auto-allow"` on macOS (tmp under `/private/var`) and Linux |
| E9 | ayolo ADDED: home is not a system dir | EP | L1 | automated | unscoped; injected home `H`; path `H/proj/new.txt` | `decideAgentPath` | `"auto-allow"` |
| E10 | apc: absolute canonical path only | EP (invalid) | L1 | automated | unscoped; path `foo/bar.txt` | `decideAgentPath` | `null` |
| E11 | ayolo: unavailable unless enforce | decision-table | L1 | automated | unscoped live session | `decideAgentPath({hostGateMode:"report"})` | `null` |
| E12 | ayolo: time-boxed / end | state-transition | L1 | automated | 15-min session auto-allowed once; (a) `now` advanced to `expiresAt`; (b) `end()` | `decideAgentPath` same path | (a) `null`, `status()` null; (b) `null` |
| E13 | ayolo: never reverses refusal (gate) | decision-table | L1 | automated | unscoped; `isRefused("agent-path", "<D>")` true; path `<D>/b.txt` | `decideAgentPath` | `"refused-by-prior-refusal"`; history outcome `refused-by-prior-refusal`; `refusedByPriorRefusal` +1; `autoAllowed` unchanged |
| E14 | design Non-Goal: exact-subject refusal | EP | L1 | automated | refusal for `<D>`; path `<D>/sub/c.txt` (`<D>/sub` exists) | `decideAgentPath` | `"auto-allow"` |
| E15 | design D3: empty-subject guard | BVA | L1 | automated | live session; eligible plane | `decide({subject:""})` | `null` |
| E16 | design D4: resolved containment | EP+BVA | L1 | automated | ancestor `/x/repo` real; candidates `/x/repo/a/new` (absent), `/x/repo-secrets/f`, `/x/repo`, ancestor unresolvable, `caseInsensitive:true` with `/X/REPO/a` | `isResolvedSubjectWithin` | `true`, `false`, `true`, `false`, `true`; `isSubjectWithin(/x/repo/a/new, /x/repo)` still `false` |
| E17 | ayolo: refusal durable/listed/clearable | state-transition | L1 | automated | `PI_ACCESS_REFUSALS_STORE` tmp file | `recordRefusal("agent-path", D)` → `__resetRefusalLedger()` → `listRefusals()` → `clearRefusal("agent-path", D)` | after reset row `{plane:"agent-path", subject:D}` present; after clear `isRefused` false; loader drops a row with `plane:"bogus"` |
| E18 | design D5: registry kind split + caps | decision-table | L1 | automated | registry with observed select `S1` and confirm `C1` for same path/subject; 40 select entries then confirm `C2` | `consume(…, kind)` | `consume(S1,"confirm")` error; `consume(C1,"select")` error; `consume(S1,"select")` ok once, second `used` error; `C2` still consumable after 40 selects |
| E19 | apc: question bound to session connection | EP (invalid) | L1 | automated | `connectionSessionId="A"`, `msg.sessionId="B"`, live unscoped YOLO | `handlePathYoloRequest` | `{verdict:"decline"}`; `decideAgentPath` not called |
| E20 | design D5: field validation | EP (invalid) | L1 | automated | msgs: `requestId` missing; `path` = 42; `path` = `"rel/x"` | `handlePathYoloRequest` | each `decline`; log line has no raw control chars |
| E21 | design D5: verdict mapping + absent dep | decision-table | L1 | automated | dep returns `auto-allow` / `refused-by-prior-refusal` / `null`; dep undefined | `handlePathYoloRequest` | `auto-allow` / `refused` / `decline`; `decline` |
| E22 | apc ADDED: Deny remembered durably (server) | EP | L1 | automated | observed select prompt `P` for session A, path `/o/dir/a.txt`, subject `/o/dir` | `handlePathGateRefusal("A", {sessionId:"A", promptId:P, path, subject})` | `recordRefusal("agent-path","/o/dir")` called once |
| E23 | apc ADDED: report needs observed prompt | EP (invalid) | L1 | automated | (a) `promptId` never observed; (b) `P` reported twice; (c) session mismatch | `handlePathGateRefusal` | (a) no record; (b) recorded once only; (c) no record |
| E24 | apc ADDED: re-derived subject | EP (invalid) | L1 | automated | observed `P` path `/o/dir/a.txt`; report claims subject `/o` | `handlePathGateRefusal` | no record; log `cause=subject mismatch` |
| E25 | design D5: unconditional record | EP | L1 | automated | observed `P` path `H/notes.txt` (subject `H`, ungrantable) | `handlePathGateRefusal` | `recordRefusal("agent-path", H)` called |
| E26 | design D7: identity carries features | decision-table | L1 | automated | `session_register` with/without announceable grant store id | event-wiring handles register | frame `{type:"dashboard_identity", features:["path-yolo"]}` sent both times; `grantStoreId` present only when announceable |
| E27 | design D5: select prompts observed | EP | L1 | automated | `prompt_request` metadata `{kind:"agent-path-gate", path, subject}` | event-wiring handles prompt_request | registry has a `select` entry for that `promptId`; replayed request does not extend TTL |
| E28 | ayolo: refusal clearable via API | EP | L1 | automated | refusal `{agent-path, D}` stored | `DELETE /api/access/refusals?plane=agent-path&subject=D`; then `plane=bogus` | 200 + row gone; 400 |
| E29 | ayolo: auto-allows reviewable | EP | L1 | automated | `history()` contains an `agent-path` auto-allow | `GET /api/access/prompts` | `verdicts` includes `{plane:"agent-path", answeredBy:"yolo"}` |
| E30 | apc: who is asked (decision table) | decision-table | L1 | automated | combos of `hasUI` × suppressed × `d.sensitive` × `d.grantable` × supported × `storeMatches` | out-of-root `write` | `yoloDecide` called iff `hasUI ∧ ¬suppressed ∧ ¬sensitive ∧ grantable ∧ supported ∧ storeMatches`; `¬hasUI` → `no-ui`; suppressed → `recently-denied` |
| E31 | apc: yolo-allowed outcome | EP | L1 | automated | `yoloDecide` → `auto-allow` | out-of-root `write` of `/o/f.txt` | returns `undefined`; `prompter.select` not called; log `[path-gate] yolo-allowed tool=write access=w path=/o/f.txt session=<sid> sensitive=false`; `counters.yoloAllowed` 1 |
| E32 | apc: yolo-refused block | EP | L1 | automated | `yoloDecide` → `refused` | out-of-root `read` | `{block:true, reason}` with reason starting `path-gate: yolo-refused`; no `select`; log outcome `yolo-refused`; `counters.blocked` +1 |
| E33 | apc: decline → prompt | EP | L1 | automated | `yoloDecide` → `decline` | out-of-root `read` | `prompter.select` called once with title `Agent wants to read outside its workspace: …` |
| E34 | apc: deny report branches | decision-table | L1 | automated | select answers: `Deny`; `undefined` (dismiss); timeout; always-allow + confirm `false`; unknown string; `Deny` with `storeMatches` false | out-of-root call | `path_gate_refusal {promptId:<select id>, path:canonical, subject}` sent for Deny and dismiss only |
| E35 | design D5: select metadata subject | EP | L1 | automated | grantable out-of-root path | prompt raised | `select` metadata includes `subject` equal to `d.subject` |
| E36 | apc: gate off / in-root untouched | EP | L1 | automated | (a) `enabled:false`; (b) in-root read | tool call | no `path_yolo_request` sent, no `yoloDecide` call |
| E37 | design D7: features validation | EP (invalid) | L1 | automated | identity `features:"path-yolo"` (string); `features:["path-yolo"]`; absent | `yolo-link.handleIdentity` → `supported()` | `false`; `true`; `false` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | apc: in-root stays cheap | tail-latency | L1 | automated | 10 000 in-root `read` calls through the handler with yolo-link wired, probe settled | p95 < 1 ms; zero `send` calls | single run |
| P2 | apc: unsupported server adds no wait | threshold | L1 | automated | identity without `features`; fake timers | out-of-root call reaches `prompter.select` with 0 ms timer advance | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | apc ADDED: open prompt does not delay in-scope call | state-convergence | L1 | automated | session S: out-of-scope call held open at `select` (unresolved promise); YOLO scoped to `R` | second call in S writes `R/out.txt` | second call resolves `undefined` while first `select` still pending; first still pending afterwards |
| F2 | apc + ayolo: unscoped YOLO end-to-end | state-convergence | L3 | automated | docker harness; `POST /api/access/yolo {unscoped:true, durationMs:900000}` | faux `tool-read-outside-grantable` | no gate card in session chat; tool result rendered; `/api/health` `accessGrants.yolo.autoAllowed` ≥ previous+1; Access YOLO history row labelled agent path gate |
| F3 | ayolo: end resumes prompting | state-transition | L3 | automated | after F2, `DELETE /api/access/yolo` | faux `tool-read-outside-grantable` again | gate card appears in chat |
| F4 | ayolo ADDED: system dir prompted under YOLO | EP | L3 | automated | unscoped YOLO live | faux `tool-read-outside` (`/etc/hostname`) | gate card appears; `autoAllowed` unchanged |
| F5 | apc ADDED: Deny listed + clearable | state-transition | L3 | automated | YOLO off | faux `tool-read-outside-grantable`, click Deny, open Settings ▸ Access | refusal row for `/srv/fixtures-outside` labelled agent path gate; clicking clear removes row (`DELETE` 200) |
| F6 | ayolo: copy names coverage | EP | L1 | automated | YOLO session unscoped / scoped | render `YoloIndicators`, `YoloAccessCard` | pill/banner text matches /agent/i; `data-testid="yolo-access-planes"` contains "Agent path gate"; no text "every folder" claiming file access only |
| F7 | ayolo: history/refusal labels | EP | L1 | automated | prompts payload with `plane:"agent-path"` verdict + refusal | render `AccessPromptsSection` | both rows show the agent-path label (not `undefined`) |
| F8 | ayolo: copy reads correctly in EN + HU | visual/subjective | — | manual-only | YOLO pill, banner, Access card in both locales | human reads | [judgment: wording accurate and natural — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | apc: budget timeout → prompt | fault-injection (delay) | L1 | automated | server never replies `path_yolo_result` | out-of-root call; fake timers | `select` called after 1500 ms (not at 1499 ms); no block |
| X2 | apc: unsent → prompt | fault-injection (abort) | L1 | automated | `send` returns `false` | out-of-root call | `select` called with 0 ms advance |
| X3 | apc fails-closed MODIFIED: answer error ≠ gate error | fault-injection (abort) | L1 | automated | `yoloDecide` throws | out-of-root call | `select` called; result not `path-gate: error` |
| X4 | design D6/D7: socket close | fault-injection (abort) | L1 | automated | pending question; connection closes | `reset()` | pending resolves `decline` → prompt; `supported()` false afterwards; next call sends no question |
| X5 | design D7: move keeps identity | state-transition | L1 | automated | `/dashboard-connect` move to target that sends `dashboard_identity {grantStoreId, features}` | move commits | `pathGate.onServerMessage` receives the frame; `storeMatches()` and `supported()` true |
| X6 | design D7: old server skew | fault-injection | L1 | automated | identity frame without `features` | 5 out-of-root calls | zero `path_yolo_request` frames sent |
| X7 | apc ADDED: refusal report delivery failure | fault-injection (abort) | L1 | automated | `send` throws on `path_gate_refusal` | operator Deny | call blocked as `denied` (same reason as today); no exception escapes |
| X8 | apc: TUI-only session unchanged under YOLO | fault (no dashboard) | — | manual-only | pi session with no dashboard connection, YOLO live on server | out-of-root write in the terminal | [judgment: terminal prompt shown as today — terminal UI not covered by the e2e harness] |

---

## Coverage summary

- Requirements covered: 13/13 delta requirements (ayolo: planes+gate, could-have-been-prompted, does-not-bypass, never-reverses-refusal, unmissable, not-yet-existing, system-dir exclusion; apc: gated-before-execution, operator-asked, fails-closed, outcome-observable, YOLO answers prompt, Deny remembered) plus design decisions D3–D7.
- Scenarios by class: edge 37 · perf 2 · frontend 8 · error 8
- Scenarios by level: L1 49 · L2 0 · L3 4 · — 2
- Scenarios by disposition: automated 53 · manual-only 2

## New infra needed

- none (e2e reuses faux `tool-read-outside[-grantable]`; YOLO activation/cleanup pattern from `access-grant-dialog.spec.ts`).
