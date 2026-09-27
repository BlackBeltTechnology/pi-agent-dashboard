# Test Plan — expose-plugin-credential-and-oauth-seams

Stage: design   Generated: 2026-09-23

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | credential-store: namespaced | EP | L1 | automated | plugin `gmail` stored key `a@x.com`; plugin `other` context | `other.list()` + `other.get("a@x.com")` | `[]` and `undefined` |
| E2 | credential-store: namespace from manifest | EP | L1 | automated | key `"../other/x"` from plugin `gmail` | `set` then read file | record under `gmail["../other/x"]`, no `other` entry |
| E3 | credential-store: key validation | BVA | L1 | automated | keys `""`, 1 char, 200 chars, 201 chars, `__proto__`, `constructor` | `set` each | 1 and 200 accepted; the other four reject typed; `Object.prototype` unchanged |
| E4 | credential-store: record size | BVA | L1 | automated | records of 65 535 / 65 536 / 65 537 serialized bytes | `set` | first two accepted; third rejects and the file bytes are unchanged |
| E5 | credential-store: namespace caps | BVA | L1 | automated | namespace with 255, 256 keys; namespace at 2 MiB − 1 KiB | `set` a new key | 256th accepted; 257th rejects; write crossing 2 MiB rejects |
| E6 | credential-store: non-plain record | EP | L1 | automated | `[]`, `"str"`, `null`, `new Date()` | `set` | each rejects typed, no write |
| E7 | credential-store: copies | state | L1 | automated | stored `{a:1}` | mutate `get()` result and `snapshot()` result | a new `get()` returns `{a:1}` |
| E8 | credential-store: list keys only | EP | L1 | automated | two records with `refresh` fields | `list()` | returns exactly the two key strings |
| E9 | credential-store: reads don't create | state | L1 | automated | no file on disk | `get`, `list`, `snapshot` | empty results; `fs.existsSync(path) === false` |
| E10 | credential-store: 0600 create | EP | L1 | automated | no file | first `set` | file mode `0o600` (POSIX) |
| E11 | credential-store: auth.json untouched | invariant | L1 | automated | auth.json with fixture bytes | 10 × set/update/remove | auth.json sha256 unchanged |
| E12 | auth.json preserved | regression | L1 | automated | existing provider-auth-storage suites | run unmodified | all pass |
| E13 | plugin flow: credential pass-through | EP | L1 | automated | fake loginFlow resolving `{access,refresh,expires,sub:"s1",email:"e"}` | complete flow | `persist` receives an object deep-equal to that value; auth.json unchanged |
| E14 | plugin flow: same-key supersede | state-transition | L1 | automated | pending flow key `k` | start second flow key `k` | first flow status `error`/cancelled; second pending |
| E15 | plugin flow: distinct keys coexist | state-transition | L1 | automated | pending flow key `k1` | start flow key `k2` | both `pending` |
| E16 | provider flow behaviour preserved | regression | L1 | automated | existing provider-auth routes/adapter suites | run unmodified | all pass |
| E17 | flow status never echoes input | EP | L1 | automated | plugin flow pending manual_code | POST input `http://127.0.0.1/?code=SECRET&state=x` | status JSON and captured logs contain no `SECRET` |
| E18 | public types | type-level | L1 | automated | runtime mirror types + server pi-oauth-types | `tsc` type test (mutual assignability) | compiles |
| E19 | loopback: match | EP | L1 | automated | helper on `127.0.0.1:0`, path `/callback` | GET `/callback?state=<helper.state>&code=abc` | resolves `{code:"abc"}`; response 200 HTML; port closed afterwards |
| E20 | loopback: stray & mismatch keep waiting | state-transition | L1 | automated | helper waiting | GET `/favicon.ico` → 404; GET `/callback?state=short` → 400; GET `/callback?state=<wrong same length>` → 400; then matching GET | resolves with code from the last request only |
| E21 | loopback: forged error | decision-table | L1 | automated | helper waiting | GET `/callback?error=access_denied` (no state), then `?error=access_denied&state=<helper.state>` | first → 400 and keeps waiting; second → rejects `access_denied` |
| E22 | loopback: bind | EP | L1 | automated | helper listening | inspect `server.address()` | address `127.0.0.1` |
| E23 | lane: success / error / no_handler | decision-table | L1 | automated | handlers: returns `{t:1}`; throws `Error("tier_denied")`; none registered | request each | `{ok:true,result:{t:1}}`; `{ok:false,error:"tier_denied"}` with no `stack`; `{ok:false,error:"no_handler"}` |
| E24 | lane: routing by plugin | decision-table | L1 | automated | plugins `a` and `b` both register `lease` | request naming `b` | only `b` handler called (spy counts a=0, b=1) |
| E25 | lane: duplicate registration | EP | L1 | automated | plugin `a` registered `lease` | register `lease` again | throws |
| E26 | lane: session attribution | EP | L1 | automated | request from socket of session S1 with payload `{sessionId:"S2"}` | dispatch | handler ctx.sessionId === `S1` |
| E27 | lane: priority independence | EP | L1 | automated | plugin priority 1000 with handler | request | reply delivered |
| E28 | lane: payload caps | BVA | L1 | automated | request 256 KiB, 256 KiB + 1; handler reply 256 KiB + 1 | send | first ok; second `request_too_large` (never sent to server); third `reply_too_large` |
| E29 | lane: non-serializable reply | EP | L1 | automated | handler returns a circular object | request | `reply_not_serializable` |
| E30 | lane: privacy | invariant | L1 | automated | spy on `pi.events.emit` for all event names | full request/reply | no emitted payload contains the request or reply |
| E31 | ui:oauth-flow registered | EP | L1 | automated | client primitive registry after startup | `useUiPrimitive("ui:oauth-flow")` inside the provider | returns the component; renders auth link + paste field for a `manual_code` status |
| E32 | mcp-server context partition | invariant | L1 | automated | `ALL_CONTEXT_MEMBERS` | `tools.test.ts` | new members classified denied; length matches the interface |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | credential-store: concurrent writes | load | L1 | automated | 20 concurrent `update` calls on one key, each incrementing a counter | final counter = 20; every call settles within the 2 s lock budget | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | plugin flow UI + completion | state-convergence | L3 | automated | demo-plugin settings section in docker harness | click "Start demo sign-in" → flow view shows auth link + paste field → paste `ok` | status converges to "complete"; demo section shows "signed in"; `plugin-credentials.json` in the container has a `demo` key |
| F2 | plugin flow cancel | state-transition | L3 | automated | demo flow pending | click Cancel | view converges to the cancelled state; a new start works |
| F3 | provider dialog unchanged | regression | L3 | automated | Settings → Providers → add an OAuth provider | open the sign-in pane | auth link, paste field and title render as before (existing provider-add spec passes) |
| F4 | flow view visual parity | visual/subjective | — | manual-only | demo-plugin flow view vs provider dialog pane | human compares | [judgment: identical look and spacing in both themes] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | cross-file quarantine | fault-injection | L1 | automated | auth.json and plugin-credentials.json both contain bytes `{"a":` | write to each | two distinct `*.corrupt-*` backups, byte-exact to the input |
| X2 | backup impossible | fault-injection (abort) | L1 | automated | corrupt file, backup dir read-only | `set` | rejects; the original corrupt file is unchanged |
| X3 | lock permission error | fault-injection (abort) | L1 | automated | lock acquisition throws `EACCES` | `set` | rejects within 100 ms with `EACCES` (no 2 s retry) |
| X4 | lock contention | fault-injection (delay) | L1 | automated | lock held by another process for 500 ms | `set` | succeeds after release; held for 3 s → rejects `ELOCKED` at about 2 s |
| X5 | early login failure | fault-injection (abort) | L1 | automated | loginFlow throws before emitting | `startFlow` | rejects `PluginFlowStartError{code:"login_failed"}`; no record in the flow store |
| X6 | start timeout | fault-injection (delay) | L1 | automated | loginFlow never emits (fake timers) | `startFlow` | rejects `{code:"start_timeout"}` at 15 s |
| X7 | registry failure isolation | fault-injection (abort) | L1 | automated | provider registry build rejects | start + GET/POST/DELETE a plugin flow | all served normally |
| X8 | openInBrowser under vitest | invariant | L1 | automated | VITEST=true, local server | start provider flow | `open` spawn spy not called |
| X9 | lane timeout | fault-injection (delay) | L1 | automated | handler never resolves (fake timers) | request | `timeout` at 15 s; a late reply is dropped |
| X10 | lane disconnect | fault-injection (abort) | L1 | automated | socket closes while pending | close | pending call resolves `disconnected` |
| X11 | lane unavailable | fault-injection (abort) | L1 | automated | symbol absent (no dashboard bridge) | plugin helper request | resolves `unavailable` immediately |
| X12 | loopback timeout / abort | fault-injection (delay/abort) | L1 | automated | no callback; separately an aborted signal | wait 5 min (fake timers) / abort | rejects timeout / abort; port closed; `close()` twice doesn't throw |
| X13 | live lane round-trip | fault-injection (none) | L3 | automated | demo-plugin `demo_echo` tool in a harness session | prompt the session to call `demo_echo` with `hi` | tool result shows `echo: hi` in the chat view |

---

## Coverage summary

- Requirements covered: 17/17
- Scenarios by class: edge 32 · perf 1 · frontend 4 · error 13
- Scenarios by level: L1 45 · L2 0 · L3 4 (+1 manual-only)
- Scenarios by disposition: automated 49 · manual-only 1

## New infra needed

- `packages/demo-plugin` gains `server` + `bridge` entries (design D8) for the L3 scenarios F1, F2, X13.
