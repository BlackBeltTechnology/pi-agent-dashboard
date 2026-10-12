# Test Plan — add-credential-vault

Stage: design   Generated: 2026-10-12

Hard gate passed. Three clarifications were answered and folded into `specs/credential-delivery/spec.md`:
- the redaction marker is `[REDACTED:<NAME>]`;
- the propagation bound is 5 s;
- the masking budget is p95 ≤ 5 ms with 20 values and a 64 KiB event.

Exemplars (harness glue to copy):
- **L1 server**:
  - `packages/server/src/__tests__/plugin-credential-store.test.ts` (locked JSON store);
  - `packages/server/src/services/__tests__/routes.test.ts` (route authority);
  - `packages/server/src/__tests__/bridge-ticket-scope.test.ts` (device trust).
- **L1 extension**:
  - `packages/extension/src/__tests__/event-forwarder.test.ts` (forwarder payloads);
  - `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (session lifecycle);
  - `packages/extension/src/__tests__/eventbus-foreign-emit-forwarding.test.ts` (EventBus).
- **L3**:
  - `tests/e2e/mcp-token-settings.spec.ts` (secret settings UI);
  - `tests/e2e/pairing-approval-dialog.spec.ts` (approval prompt);
  - `tests/e2e/tool-output-selection.spec.ts` (tool output in the chat view).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | credential-vault: Account storage | BVA | L1 | automated | `key` values of 7, 8 and 9 characters | add account | 7 is rejected with a validation error and no file write; 8 and 9 are stored |
| E2 | credential-vault: Account storage | state | L1 | automated | no vault file | list accounts, then add the first account | no file after listing; after the add, the file exists with mode `0600` |
| E3 | credential-vault: Account storage | EP | L1 | automated | file containing `{kind:"oauth", namespace:"service:x"}` | add a `key` account | the unknown account is byte-identical after the write |
| E4 | credential-vault: Account storage | concurrency | L1 | automated | 2 concurrent `add` calls | `Promise.all` | both accounts present |
| E5 | credential-vault: Corrupt vault file | fault | L1 | automated | `vault.json` = `{"a":"sk-live-ABCDEFGH` (truncated) | add account | write refused; a backup exists and is byte-equal; the error string does not contain `sk-live` |
| E6 | credential-vault: Env bindings | EP + BVA | L1 | automated | `GEMINI_API_KEY`, `gemini_key`, `PATH`, `Path`, `LD_PRELOAD`, `GIT_SSH_COMMAND`, `PI_CODING_AGENT_DIR`, `HTTPS_PROXY`, `XDG_CONFIG_HOME`, `JAVA_TOOL_OPTIONS` | create binding | only `GEMINI_API_KEY` is accepted; every other name gets a validation error (`gemini_key` fails the regex, `Path` is a reserved name in another case) |
| E7 | credential-vault: Env bindings | fault | L1 | automated | hand-edited vault with binding `PATH`, granted | delivery snapshot built | the snapshot has no `PATH` entry |
| E8 | credential-vault: Per-project grants | EP | L1 | automated | origins `https://github.com/acme/app.git`, `git@github.com:acme/app`, `ssh://git@github.com:22/acme/app`, `https://user:tok@GitHub.com/acme/app/` | normalise | all four give `github.com/acme/app` |
| E9 | credential-vault: Per-project grants | EP | L1 | automated | `https://host:8443/a/b`, `http://host:80/a/b`, `https://github.com/Acme/App`, `file:///srv/repo`, `/srv/repo` | normalise | `host:8443/a/b`; `host/a/b`; `github.com/Acme/App`, which does not equal the lower-case form; no repository key for either local origin |
| E10 | credential-vault: Per-project grants | decision table | L1 | automated | binding default "personal"; grant A overrides with "work"; grant B has no override; project C has no grant | resolve for A, B, C | A gets the "work" value; B gets "personal"; C gets nothing |
| E11 | credential-vault: Per-project grants | state | L1 | automated | grant to (device A, `/work/scratch`) | sessions at (B, `/work/scratch`), (A, `/work/scratch/sub`), (A, `/work/scratch`) | delivered only to (A, `/work/scratch`) |
| E12 | credential-vault: Per-project grants | fault | L1 | automated | `git remote get-url` exits with 128 | resolve key | directory key used; only directory grants apply |
| E13 | credential-vault: Checkout confirmation | state | L1 | automated | repository grant for `github.com/acme/app`; checkout at (A, `/src/app`) | (1) not confirmed; (2) confirmed; (3) origin changed to `github.com/acme/other`, which also has a grant | (1) nothing, state `pending-confirmation`; (2) delivered; (3) nothing from the `acme/other` grant until it is confirmed |
| E14 | credential-vault: Account rotation and revocation | decision table | L1 | automated | grant A overrides with "work"; binding default "personal" | revoke "work" | grant A is `no-account`; project A gets nothing (no fallback to "personal") |
| E15 | credential-vault: Account rotation and revocation | state | L1 | automated | binding default = "x"; no overrides | revoke "x" | binding has no default; grants are `no-account`; push to holders |
| E16 | credential-vault: Non-destructive import | EP | L1 | automated | upload `.env` with `A_KEY=abcdefgh12`, `B_KEY=abc`, `export C_KEY="q u o t e d1"`; plus an upload of 65 537 bytes | propose, then confirm | the proposal lists `A_KEY` and `C_KEY` only, by name with no lengths; `B_KEY` is skipped with a notice; the oversized upload is rejected |
| E17 | credential-vault: Non-destructive import | fault | L1 | automated | request `{source:"/etc/passwd"}`, and an unknown candidate id | import | both rejected; `fs.readFile` is never called with that path (spy) |
| E18 | credential-vault: Non-destructive import | state | L1 | automated | known candidate `.env` | list candidates, select one, confirm | no read before selection; the source file's mtime and bytes are unchanged afterwards |
| E19 | credential-vault: Plugin read access | decision table | L1 | automated | plugin declares `POLY_PIZZA_KEY`; states: undeclared, declared + unapproved, approved, revoked, and an update that adds `GEMINI_API_KEY` | read | value returned only for "approved"; the newly added declaration returns nothing until it is approved |
| E20 | credential-delivery: Local values take precedence | decision table | L1 | automated | env holds `GEMINI_API_KEY` before delivery / set by a spawn contributor / not set; on win32, `Gemini_Api_Key` set | deliver | `local-override` for both pre-set cases and for the win32 case-variant; delivered when unset |
| E21 | credential-delivery: Rotation, revocation and reconciliation | state | L1 | automated | delivered `GEMINI_API_KEY`; the user then overwrites it | revoke via push; and separately via reconnect reconciliation | the user's value is kept in both paths, and the name is dropped from tracking |
| E22 | credential-delivery: Nested pi sessions | state | L1 | automated | parent delivered `GEMINI_API_KEY` and `SONIOX_API_KEY`; child env inherits them plus the marker `PI_DASHBOARD_VAULT_DELIVERED=GEMINI_API_KEY,SONIOX_API_KEY` | child bridge starts; the child receives a revoke push | the child's redaction set holds both values; no `local-override`; the child does not unset them; the marker contains no `=` value or hash |
| E23 | credential-delivery: Redaction | EP | L1 | automated | value `abcdefgh12` delivered as `GEMINI_API_KEY` | `tool_result` with the value in `content[0].text`, `details.truncation.content`, `structuredContent.x`, and a full-output file | all four show `[REDACTED:GEMINI_API_KEY]` and none contains `abcdefgh12` |
| E24 | credential-delivery: Redaction | BVA | L1 | automated | value of length L = 20 split across snapshots at offsets 1, 10 and 19, then `tool_execution_end` | forward the updates | no forwarded payload contains any length-≥1 prefix of the value at its end; the end event carries the full masked text; no characters are lost compared with the raw stream |
| E25 | credential-delivery: Redaction | EP | L1 | automated | `message_end` whose assistant text and tool-call argument contain the value | `message_end` handler | the replacement message has the masker in both places; `role` and `usage` are deep-equal to the original |
| E26 | credential-delivery: Redaction | BVA | L1 | automated | `user_bash` `onData` chunks splitting the value and a 4-byte UTF-8 character across chunk boundaries | wrapped operations stream, then exit | the output has the masker; the UTF-8 character is intact; the tail is flushed on exit |
| E27 | credential-delivery: Redaction | state | L1 | automated | value rotated from `old12345678` to `new12345678` | a process prints the old value | masked as `[REDACTED:<NAME>]` |
| E28 | catch-all-event-forwarding: vault exception | EP | L1 | automated | session with no vault values | forward `tool_execution_update`, `message_update`, EventBus payload | payloads are deep-equal to the input; no delay |
| E30 | catch-all-event-forwarding: vault exception | state-transition | L1 | automated | session holding a value; a `message_update` stream with held tail characters | a `tool_execution_start` event follows before `message_end` | the forwarded sequence is: held characters (masked), then `tool_execution_start`; nothing is reordered |
| E29 | catch-all-event-forwarding: vault exception | invariant | L1 | automated | session holding a value; a pi event object containing it | forward | the forwarded copy is masked; the original pi event object is not mutated (deep-equal to a pre-forward snapshot) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | credential-delivery: Redaction overhead is bounded | tail-latency | L1 | automated | 20 held values (8–64 characters), 1 000 forwarded 64 KiB `tool_execution_update` payloads with occurrences at random offsets | masking time per event, p95 ≤ 5 ms | 1 000 events after 100 warm-up events |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | credential-vault: Values never leave the hub | state-convergence | L3 | automated | vault with 2 accounts | open the Vault settings page; capture all `/api/vault*` network responses | no response body contains either value; the page lists both labels |
| F2 | credential-vault: Checkout confirmation | state-transition | L3 | automated | repository grant; a session in an unconfirmed checkout | open session details, then click Confirm | the binding state shows `pending-confirmation`, then converges to `delivered` without a page reload |
| F3 | credential-delivery: Redaction | state-convergence | L3 | automated | session holding `GEMINI_API_KEY` | agent runs `printenv GEMINI_API_KEY` | the chat tool output shows `[REDACTED:GEMINI_API_KEY]`; the DOM text never contains the value, sampled on every mutation |
| F4 | credential-delivery: Delivery is observable | state-convergence | L3 | automated | session with `delivered`, `local-override` and `revoked` bindings | open session details | three rows with those states; the `revoked` row carries the running-process note; no values in the DOM |
| F5 | credential-vault: Plugin read access | state-transition | L3 | automated | demo plugin declaring `POLY_PIZZA_KEY` | Settings: approve, then revoke | the toggle state persists across a reload; the plugin's read endpoint returns a value only while approved |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | credential-delivery: Delivery only to granted sessions | fault-injection | L1 | automated | remote connection authenticated, but over `ws://` | session start | no delivery; event outcome `transport-insecure` |
| X2 | credential-delivery: Delivery only to granted sessions | fault-injection | L1 | automated | remote connection without a paired-device ticket | session start | no delivery |
| X3 | credential-delivery: Rotation, revocation and reconciliation | fault-injection (abort) | L1 | automated | bridge disconnected; the binding is revoked meanwhile | reconnect | the variable is unset after the reconcile snapshot |
| X4 | credential-delivery: Rotation, revocation and reconciliation | fault-injection | L1 | automated | hub identity lacks the `vault-delivery` feature | bridge holding 2 values reconnects | both values unset |
| X5 | credential-delivery: Rotation, revocation and reconciliation | fault-injection | L1 | automated | `ctx.sessionManager.getCwd()` throws on a `resume` start | session_start | every delivered value is unset; nothing new is delivered |
| X6 | credential-delivery: Rotation, revocation and reconciliation | state-transition | L1 | automated | process launched in project A with `GEMINI_API_KEY`; resumed session in project B, which has no grant | session_start(`resume`) | `GEMINI_API_KEY` is unset |
| X7 | credential-delivery: Bounded retention | BVA (clock) | L1 | automated | hub unreachable; grace 24 h; injected clock at 23 h 59 m, 24 h 0 m 1 s, and wall-clock +25 h with monotonic +1 h (sleep) | grace check | kept; withdrawn; withdrawn |
| X8 | credential-delivery: Bounded retention | BVA | L1 | automated | hub grace set to 0 h, 1 h, 168 h, 500 h | snapshot | clamped to 1 h, 1 h, 168 h, 168 h |
| X9 | credential-delivery: Rotation, revocation and reconciliation | fault-injection | L1 | automated | vault corrupt | bridge reconnect; user flips "disable delivery" | the reconnect keeps the values (treated as unreachable); disabling then unsets all values |
| X10 | credential-delivery: Rotation, revocation and reconciliation | tail-latency | L1 | automated | connected session; fake hub | rotate the account | the new value appears in the session's env within 5 s (fake timers + real push path) |
| X11 | credential-delivery: Disabling delivery | state-transition | L1 | automated | delivered `SONIOX_API_KEY` | `session_shutdown(reload)`, then `session_start(reload)`; then disable delivery | the value persists across the reload; it is unset after disable |
| X12 | credential-vault: Values never leave the hub | authz | L1 | automated | `observe`-tier bearer; `operate` bearer; locally trusted caller | GET/POST on vault management routes; GET session binding state | observe is refused on management routes and allowed on session state; operate and local trust are allowed |
| X13 | credential-delivery: Env bindings delivered | fault-injection | L3 | automated | real pi session in the docker harness, granted `GEMINI_API_KEY` | agent runs `node -e "console.log(process.env.GEMINI_API_KEY?.length)"` before and after the grant | before: `undefined`; after the grant, within 5 s: `10`. The real bash env picks it up live |
| X14 | credential-vault: Account storage | platform | — | manual-only | Windows host | add an account; read `vault.json` as another local user | [judgment: needs a second Windows account; observed access denied] |

---

## Coverage summary

- Requirements covered: 22 of 22. Covered across both capabilities and the MODIFIED forwarding requirement:
  - `credential-vault`: storage, corrupt file, values never leave, env bindings, grants, checkout confirmation, rotation, import, plugin read;
  - `credential-delivery`: trust, env delivery, nested pi, local precedence, rotation and reconciliation, redaction, overhead, retention, disable, observability;
  - the MODIFIED forwarding requirement.
- Scenarios by class: edge 30 · perf 1 · frontend 5 · error 14
- Scenarios by level: L1 43 · L2 0 · L3 6 · manual 1
- Scenarios by disposition: automated 49 · manual-only 1

## New infra needed

- **L3 real-pi env scenario (X13).** The docker harness must start a pi session in a checkout that the test can confirm through the UI. Reuse the harness's existing spawned session; no new harness is expected (verify during apply).
