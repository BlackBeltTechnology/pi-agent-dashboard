# Test Plan — investigate-auto-name-provenance-relabel

Stage: design   Generated: 2026-10-11

No clarifications — every Triple slot is concrete (provenance literals, wire messages,
persisted fields). No rendered surface reads `nameSource`, so there is no L3 row.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | bridge-auto-session-namer › classification (`classifyNameChange`) | decision-table | L1 | automated | `lastSelfApplied` ∈ {unset,"A"} × `lastSystemApplied` ∈ {unset,"S"} × observed ∈ {"A","S","X","A\nB" vs "A B"} | `classifyNameChange(observed, self, system)` | returns `self` iff sanitized observed = self; `system` iff = system; else `external` — 12 reachable combos table-asserted |
| E2 | bridge-auto-session-namer › D1 lattice (`noteSystemRename`) | state-transition | L1 | automated | namer in each of {absent, `auto` named "T", `system` "S", `user`} | `noteSystemRename("N")` then `noteSystemRename("")` | absent/auto/system → `system`, `hasAutoName=false`, `lastSelfApplied` unset, `lastSystemApplied="N"`; then `""` → nameSource unset, eligible; `user` → stays `user` on both |
| E3 | bridge-auto-session-namer › eligibility pre-call branch | decision-table | L1 | automated | namer `nameSource:"system"`, toggle on, substantive transcript, stub `streamSimple` spy | `maybeName()` | `streamSimple` called 0×; `reportOutcome` once with `already-named` and a system reason; `attemptsUsed` 0 |
| E4 | bridge-auto-session-namer › in-flight system rename | state-transition | L1 | automated | `maybeName()` awaiting a deferred stub stream returning a valid title | `noteSystemRename("add-x")` then resolve stream | `applyName` not called; outcome `already-named` (not `locked-out`); `nameSource` `system`; `attemptsUsed` 0 |
| E5 | bridge-auto-session-namer › restore adoption (`adoptRestoredNamerState`) | EP | L1 | automated | raw restore with `nameSource` ∈ {"auto","user","system","bogus",42,absent} + `nameSourceFor` ∈ {"A",absent,7} | `adoptRestoredNamerState(raw)` → `createAutoNamer(.., adopted)` | auto+"A" → `hasAutoName`, observe "A" ⇒ self; system+"A" ⇒ observe "A" ⇒ system; user ⇒ `maybeName` reports `locked-out`; bogus/42 ⇒ provenance ignored; non-string witness ignored |
| E6 | bridge-auto-session-namer › witness-less restore (provisional trust) | state-transition | L1 | automated | restored `{nameSource:"auto"}` with no witness | observe "A" then observe "A" then observe "B" | first two: no `reportUserRename`; third ("B"): exactly one `reportUserRename("B")`, `nameSource` `user` |
| E7 | bridge-auto-session-namer › restore into live namer, same name | state-transition | L1 | automated | live namer latched `user` + `hardStopped` (no `stopCause`) from observing "A"; live pi name "A" | `restoreProvenance({nameSource:"auto", nameSourceFor:"A"}, liveName "A")` | `nameSource` `auto`, `hardStopped` false; next observe "A" ⇒ no `reportUserRename` |
| E8 | bridge-auto-session-namer › restore never downgrades genuine user | state-transition | L1 | automated | live namer latched `user` from observing "B"; live pi name "B" | `restoreProvenance({nameSource:"auto", nameSourceFor:"A"}, liveName "B")` | `nameSource` stays `user`, `hardStopped` stays true |
| E9 | bridge-auto-session-namer › stop-cause preservation on restore | decision-table | L1 | automated | restored provenance `auto`; stop with `stopCause` ∈ {undefined, budget, role, registry, credentials, other} | adopt restore | only `stopCause: undefined` is cleared; the 5 caused stops keep `hardStopped:true` |
| E10 | session-rename › server guard (`session_name_update` handler) | decision-table | L1 | automated | session provenance ∈ {absent, auto "W", system "W", user} × claim ∈ {`user` "W", `user` "W\n" (sanitizes to W), `user` "X", `auto` "T", none "X"} | bridge sends `session_name_update` | user-claim on witness ⇒ provenance kept; user-claim "X" ⇒ `user`, `nameSourceFor` cleared; auto-claim while system/user ⇒ name AND provenance unchanged; plain update ⇒ name applied, witness kept |
| E11 | session-rename › poll-before-claim ordering | state-transition | L1 | automated | session `auto` witness "Fix login", name "Fix login" | plain `session_name_update{name:"Fix login"}` then `{name:"Fix login", nameSource:"user"}` | `nameSource` remains `auto`, `nameSourceFor` "Fix login" |
| E12 | session-rename › programmatic senders tag system | EP | L1 | automated | session `name` undefined, provenance absent; separately provenance `user` | each of: REST attach, browser attach (`applyAttachProposal`), auto-attach on detected change, trusted-plugin `renameSession` | `rename_session` sent with `origin:"system"`; provenance `system` + witness = new name; with prior `user` ⇒ stays `user` |
| E13 | dashboard-server › REST rename / session-rename › user tags | EP | L1 | automated | session provenance `system` witness "add-x"; no bridge connected | `POST /api/session/:id/rename {name:"mine"}`; and browser `rename_session` | `nameSource` `user`, `nameSourceFor` absent; `rename_session` to bridge has NO `origin` |
| E14 | openspec-attach-combo / proposal-attachment › detach revert matrix | decision-table | L1 | automated | `name:"foo"`, `attachedProposal:"foo"`, provenance ∈ {absent, auto, system, user}; plus `name:"my"` | `detachShouldClearName` + REST and browser `detach_proposal` | absent/auto/system ⇒ name, `nameSource`, `nameSourceFor` cleared and `rename_session{name:"",origin:"system"}` sent; user or "my" ⇒ name kept, no `rename_session` |
| E15 | meta-json-session-cache › `nameSourceFor` persistence | state-transition | L1 | automated | session with `nameSource:"system"`, `nameSourceFor:"add-x"` | unrelated field update triggers full-overwrite save; then `scanAllSessions` cold start | `.meta.json` and rescanned session both carry `nameSource:"system"`, `nameSourceFor:"add-x"` |
| E16 | session-rename › witness not forgeable by plugin | EP | L1 | automated | plugin ref body `{ nameSourceFor: "evil" }` | pending plugin ref merge | `nameSourceFor` key rejected/stripped (in `CORE_RESERVED_REF_KEYS`), session witness unchanged |
| E17 | bridge-auto-session-namer › server restore projection | decision-table | L1 | automated | session ∈ {no state+no nameSource, `nameSource:"system"` no state, `nameSource:"auto"`+state.nameSource "user"+`hardStopped` no cause, `nameSource:"user"`+stopped} | `session_register` | none ⇒ no restore sent; system ⇒ restore carries `system`+witness; auto/stale-user ⇒ restore carries `auto` and `hardStopped:false`; user ⇒ `user`, `hardStopped:true` |
| E18 | shared › `sanitizeSessionName` move | EP | L1 | automated | "A\r\nB  ", "  A ", "A" | call via `@…/pi-dashboard-shared/session-name.js` and via the extension re-export | both return "A B", "A", "A" (same function identity) |

### Performance

_None — no latency/throughput budget in scope; the guard is O(1) per message._

### Frontend-quirk

_None — no client code reads `nameSource` (`rg nameSource packages/client/src` empty)._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | bridge-auto-session-namer › failed system rename | fault-injection (abort) | L1 | automated | `pi.setSessionName` throws | command-handler receives `rename_session{name:"add-x",origin:"system"}` on a namer with provenance `auto` "T" | namer provenance back to `auto`, `lastSystemApplied` unset, persisted state reflects the rollback; later observe "T" ⇒ no `reportUserRename` |
| X2 | bridge-auto-session-namer › restart race (restore arrives after observation) | fault-injection (delay) | L1 | automated | `auto_name_state_restore` delivered AFTER a `session_info_changed("A")` and a turn-end on a bridge whose restored session is `auto` "A" | bridge harness drives event then restore | no persisted `user` survives server-side (server guard); bridge namer ends `auto`, not stopped; next turn-end sends no `session_name_update{nameSource:"user"}` |
| X3 | bridge-extension › system echo via `session_info_changed` | fault-injection (reorder) | L1 | automated | echo `session_info_changed("add-x")` fires synchronously inside `pi.setSessionName` | server sends `rename_session{origin:"system"}` | 0 `session_name_update{nameSource:"user"}` sent; namer `system` |
| X4 | bridge-auto-session-namer › session resume | state-transition | L1 | automated | bridge on session S1, switches to S2 persisted `auto` "Fix login" | `session_start(resume)` → register → restore for S2 → turn-end observes "Fix login" | no `user` latch for S2; S1's namer state not carried into S2 |
| X5 | mixed versions › old server | fault-injection (degraded peer) | L1 | automated | server sends `rename_session` with no `origin` and a stop-only restore | attach-style rename "add-x" then echo | behaviour identical to today: classified external, `user` (proves no crash / no new outage) |
| X6 | mixed versions › old bridge | fault-injection (degraded peer) | L1 | automated | bridge ignores `origin`, sends `session_name_update{name:"add-x",nameSource:"user"}` after a system attach rename | server handler | `nameSource` stays `system` (guard) |
| M1 | live fleet verification | operator check | — | manual-only | real dashboard + real pi + `@naming` model | new session auto-named, then `pi-dashboard` restart and pi process restart, then attach/detach a change on another session | `.meta.json` keeps `nameSource:"auto"` + witness after restart; attach-named session shows `system`; a fresh fleet scan shows new `auto`/`system` rows accumulating [judgment: real-model end-to-end on the live fleet] |

---

## Coverage summary

- Requirements covered: 15/15 (all ADDED/MODIFIED requirements across 7 capability deltas)
- Scenarios by class: edge 18 · perf 0 · frontend 0 · error 7
- Scenarios by level: L1 24 · L2 0 · L3 0
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

none — all rows extend existing vitest suites (exemplars recorded in tasks.md).
