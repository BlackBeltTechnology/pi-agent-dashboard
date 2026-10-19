# Test Plan — add-services-settings-ui

Stage: design   Generated: 2026-10-15

Gate answers (2026-10-15): docker/podman CLI behaviour is verified with **recorded fixtures only** (no live check); **no latency budget**, so no performance scenarios.

Levels: `L1` vitest (`packages/server/src/services/__tests__/`, `packages/server/src/__tests__/`, `packages/client/src/components/settings/services/__tests__/`), `L3` Playwright vs the docker harness (`tests/e2e/services-settings.spec.ts`; port from `.pi-test-harness.json`, never hard-coded). L3 services are user-origin `attached` definitions whose start command is a `node -e` script, so no container runtime is needed in the harness.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Logs route · tail | BVA | L1 | automated | native service with 3000 output lines | `GET …/logs?tail=` 0, 1, 200 (absent), 2000, 2001, `abc` | 0/2001/`abc` → 400 `invalid-tail`; 1 → 1 line; absent → 200 lines; 2000 → 2000 lines |
| E2 | Logs route · 512 KiB cut | BVA | L1 | automated | 2000 lines of 400 bytes each (≈ 800 KiB) | `tail=2000` | response lines total ≤ 512 KiB, every line whole, last line = last line of the file |
| E3 | Logs route · redaction | EP | L1 | automated | secret `token`=`s3cr3t-value`; output `auth s3cr3t-value ok` | logs read | line is `auth «secret:token» ok` |
| E4 | Logs route · overlapping values | decision-table | L1 | automated | `a`=`pass1234`, `b`=`pass1234xyz`; output `pass1234xyz pass1234` | logs read | line is `«secret:b» «secret:a»` |
| E5 | Logs route · marker not re-matched | EP | L1 | automated | `a`=`secret`, `b`=`token-secret`; output `token-secret` | logs read | line is `«secret:b»` (no nested marker) |
| E6 | Logs route · multi-line value at window edge | BVA | L1 | automated | 2-line value; printed so only its 2nd line is in the last N=5 lines | `tail=5` | no response line contains either half of the value |
| E7 | Logs route · short value | BVA | L1 | automated | configured secret values of length 3 and 4 | logs read | length 3 → `secret-too-short`, `secret` = its name, no lines; length 4 → output with marker |
| E8 | Logs route · unset vs unreadable | decision-table | L1 | automated | (a) store secret never set; (b) keychain resolver returns `unreadable`; (c) both, (b) declared first | logs read | (a) output returned; (b) `secret-unavailable` + `secret` named; (c) `secret` = the first in declaration order |
| E9 | Logs route · reason precedence | decision-table | L1 | automated | external mode; attached `startedBy: external` with/without file; native with no file; no `start.json` | logs read | `external`; file → lines; no file → `external`; `no-output`; `no-output` |
| E10 | Logs route · stale flag | state-transition | L1 | automated | native service `failed` after writing 2 lines | logs read | 2 lines, `stale: true`; same service healthy → `stale: false` |
| E11 | Logs route · OCI merge | EP | L1 | automated | recorded `docker logs --timestamps` stdout + stderr fixtures, one equal-timestamp pair | logs read | lines in timestamp order, stdout first on the tie, timestamp prefix stripped |
| E12 | Logs route · OCI argv | EP | L1 | automated | OCI service, `start.json` startedAt T, longest secret 3 lines, `tail=10` | logs read | runner argv = `logs --timestamps --since <T RFC 3339> --tail 12 <containerId>` |
| E13 | Logs route · duplicate containers | EP | L1 | automated | two owned containers match | logs read | `duplicate-instances`, no lines |
| E14 | Start record | EP | L1 | automated | OCI start with secrets `a`,`b` | start, then server-restart adoption | `start.json` 0600 holds startedAt + digest; adopted instance carries the same values; digest ≠ plain SHA-256 of the pairs |
| E15 | Start record · restartRequired | state-transition | L1 | automated | running native service | `PUT …/secrets/token`, then new manager instance (restart) | status `restartRequired: true` before and after restart; false after next start |
| E16 | Output capture · new start clears | state-transition | L1 | automated | native `output.log` with 10 lines, inode I | start again | file holds only new output, inode still I |
| E17 | Output capture · cap boundary | BVA | L1 | automated | file at 1 MiB − 1, 1 MiB, 1 MiB + 1 | 5 s check | only 1 MiB + 1 is truncated to 0; next child write lands at offset 0 |
| E18 | Output capture · unleased child | state-transition | L1 | automated | idle native service, no lease, file 1.5 MiB | 5 s check | truncated in place (same inode) |
| E19 | Output capture · path fallback | decision-table | L1 | automated | no fd held (after restart); path inode matches / differs from `start.json`; descriptor truncation throws | check | match → truncated by path; differs → untouched; descriptor throws → path fallback used |
| E20 | Output capture · external | EP | L1 | automated | attached instance adopted `startedBy: external` | adoption | no `output.log` created |
| E21 | Reset data · state gate | decision-table | L1 | automated | states stopped, healthy, unavailable×{runtime-unreachable, adoption-uncertain, duplicate-instances, owner-conflict}, stopped with running owned container | `POST …/reset-data` | only stopped and unavailable/runtime-unreachable proceed; rest 409 `not-resettable`, no runtime call |
| E22 | Reset data · volume guard | decision-table | L1 | automated | volume declared by another definition; volume mounted by foreign container; neither | reset | `{volumes:[…]}` reports `volume-shared`, `volume-in-use`, `removed: true`; `volume rm` never gets `-f` |
| E23 | Reset data · no volumes | EP | L1 | automated | stopped native service | reset | 409 `no-data` |
| E24 | Remove with purge · guard | decision-table | L1 | automated | `DELETE …?purgeData` with one shared, one in-use, one free volume | remove | definition gone; result lists free removed, other two kept with reasons |
| E25 | Prune · candidates | decision-table | L1 | automated | run dirs `tika` (undefined, dead pid), `.docker-config`, `docling` (defined), `Bad_Name`, `old` (leader dead, group alive), `perm` (kill → EPERM); owned orphan container stopped + one running; foreign-owner container | dry run | candidates = `tika` + stopped orphan; running orphan reported skipped; nothing else listed; nothing removed |
| E26 | Prune · confirm intersection | state-transition | L1 | automated | dry run lists `tika`,`zed`; `tika` added before confirm | `{dryRun:false, ids:[tika,zed,extra]}` | removed `zed`; skipped `tika`; `extra` ignored; `tika` dir still exists |
| E27 | Prune · definitions file | decision-table | L1 | automated | `services.json` missing / corrupt, owned container exists | prune | 409 `definitions-missing` / 409 corrupt; container still exists |
| E28 | Lease holders | EP | L1 | automated | `ensure` with holder `session-abc` and a 300-char holder | list + status | holder listed with ISO `expiresAt`; long holder stored as 200 chars; no `leaseId` anywhere in either body |
| E29 | canOperate | decision-table | L1 | automated | caller: operate device bearer, observe bearer, control login session, operate login session, trusted-network unauth, local | `GET /api/services` | `true`, `false`, `false`, `true`, `false`, `true` — each equal to whether `POST …/start` is accepted |
| E30 | Owner-scoped stop | EP | L1 | automated | no recorded instance; containers `pi.service=docling` with own and with foreign `pi.owner` | `stop` | runner stop argv lists only the own container |
| E31 | Route tiers | EP | L1 | automated | route-tier table | completeness test | logs, reset-data, prune carry tier `operate`; MCP manifest test still green via the `/api/services/` denylist |
| E32 | Settings registry | decision-table | L1 | automated | paths `/settings/services`, `/settings/services/docling`, `/settings/services/nope`, `/settings/runtimes/x`, folder `/folder/<cwd>/settings/services` | route parse | `activeTab` services / services + `activeServiceId` docling / list + not-found notice / runtimes (segment ignored) / folder invalid-page fallback |
| E33 | Action gating | decision-table | L1 | automated | every state × relevant reason × `startedBy` × mode × volumes declared | render detail actions | matches the D9 table exactly (Try again, Stop hidden for external, Force only adoption-uncertain/external, Stop for duplicate-instances, Reset only with volumes, Pin only managed) |
| E34 | List grouping | EP | L1 | automated | one service per state | render list | Needs attention (unavailable/failed/blocked/stop-failed) → Running (healthy/idle/starting/stopping) → Stopped; counts right; empty group absent; nav indicator has a text alternative |
| E35 | Save Bar exemption | state-transition | L1 | automated | Services page | stop a service, save a secret | Save Bar absent, unsaved count unchanged |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Live updates | state-convergence | L3 | automated | attached service with a 2 s startup delay, list page open | Start | row converges `starting` → `healthy` without reload; no request to `GET /api/services/:id` while the detail is closed |
| F2 | Live updates · detail does not re-probe | state-convergence | L1 | automated | detail open; 5 `services_changed` messages | messages arrive | only `GET /api/services` refetches (one per message after a 100–400 ms delay); zero `GET /api/services/:id` until Refresh |
| F3 | Live updates · reconnect | state-transition | L3 | automated | list open; service stopped via REST while the WS is dropped | WS reconnect | row shows `stopped` after reconnect, no reload |
| F4 | Notification · gateway class | state-transition | L1 | automated | `services_changed` frame | gateway classifier | `{ cls: "state", key: "services_changed" }`; not shed under transcript budget |
| F5 | Notification · choke points | state-transition | L1 | automated | tick idles a healthy service; adoption via `init()`; lease expiry in sweep; pin; `setSecret` on configured secret | each event | exactly one change callback per event; frame body is `{"type":"services_changed"}` only |
| F6 | Notification · coalescing | BVA | L1 | automated | 10 changes within 100 ms, then 1 change 600 ms later | coalescer (fake timers) | burst → ≤ 2 frames incl. trailing; later change → 1 frame |
| F7 | Add flow | state-transition | L3 | automated | pasted attached JSON | Review → Add service, prefetch unticked | dry-run request first, then `dryRun:false`; no prefetch request; row appears |
| F8 | Add flow · invalid JSON | EP | L3 | automated | JSON with unknown key `privileged` | Review | error listed one per line; Add service unavailable; `services.json` unchanged |
| F9 | Secret entry | state-transition | L3 | automated | store-backed secret `token` | type value, Save | input empty after save; badge `Set`; value never in DOM, network responses, or React state after submit |
| F10 | Destructive confirms | state-transition | L3 | automated | stopped service with a volume | Reset data | confirm disabled until the exact id is typed; Remove without ticking → request has no `purgeData` |
| F11 | Prune confirm | state-transition | L3 | automated | one orphan run dir | Clean up leftovers → confirm | dialog lists it; confirm sends exactly the previewed ids; skipped list rendered when non-empty |
| F12 | Read-only | decision-table | L3 | automated | observe-tier session (`canOperate:false`) | open detail | every action disabled; one banner with remedies; zero requests to `…/logs` |
| F13 | Logs viewer | EP | L3 | automated | attached service printing `<script>alert(1)</script>` and its secret | Load output | literal text shown, no script runs, secret shown as a marked `«secret:…»` |
| F14 | Lease holder text | EP | L3 | automated | lease holder `<img src=x onerror=alert(1)>` | open detail | literal text shown, no request to `x`, no alert |
| F15 | Accessibility | invariant | L3 | automated | list + detail + runtimes in base dark, base light | axe + computed contrast probe + Tab walk | no AA contrast failure; every action reachable by Tab with a visible focus ring; pills readable by text |
| F16 | Theme tokens | invariant | L1 | automated | new client files under `components/settings/services/` | source scan | no raw colour literal (hex/rgb) |
| F17 | Visual polish vs mockup | visual/subjective | — | manual-only | Services pages in nord dark on a 390 px phone | human compares with `mockups/services-settings` | [judgment: hierarchy and spacing read like the mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Logs route · runner timeout | fault-injection (delay) | L1 | automated | runner returns `timedOut: true` with partial stdout | logs read | `runtime-error`, no lines |
| X2 | Logs route · runner cap | fault-injection (abort) | L1 | automated | runner returns `truncated: true` | logs read | `runtime-error`, no lines |
| X3 | Logs route · secrets changed | fault-injection | L1 | automated | `env:` value changes after start (digest mismatch) | logs read | `secrets-changed`, no lines; after restart → lines returned |
| X4 | Logs route · rotation then restart | state-transition | L1 | automated | output had `old-value-1`; value saved; service restarted | logs read | no line contains `old-value-1` |
| X5 | Logs route · authority | decision-table | L1 | automated | observe bearer; trusted-network unauth; operate bearer | `GET …/logs` | 403 `insufficient_scope`; 403 `operate_required` with remedies; 200 |
| X6 | Reset data · runtime failure | fault-injection (abort) | L1 | automated | `ps` fails; `inspect` fails (returns `null` after this change) | reset | 409 `runtime-unreachable`; no `rm`, no `volume rm` issued |
| X7 | Reset data · container rm fails | fault-injection (abort) | L1 | automated | owned container started between check and `rm` (plain `rm` exits non-zero) | reset | 409 `not-resettable`; no `volume rm` issued |
| X8 | Reset data · volume came into use | fault-injection | L1 | automated | `volume rm` exits non-zero (in use) | reset | volume reported kept, reason `volume-in-use`; other volumes processed |
| X9 | Prune · unreachable runtime | fault-injection (abort) | L1 | automated | podman unreachable, docker reachable | dry run | `unreachableRuntimes: ["podman"]`; docker orphans still listed |
| X10 | Action refused inline | fault-injection | L3 | automated | server returns 409 with code + hint for Start | click Start | error code + hint shown at the action, no toast |
| X11 | operate_required inline | fault-injection | L3 | automated | trusted-network caller without operate | click Stop | reason + remedies at the action |
| X12 | Corrupt definitions | fault-injection | L3 | automated | `services.json` corrupt with a backup path | open list | error banner naming the backup path; prune refused |
| X13 | Runtimes page | fault-injection | L1 | automated | runtime report: docker installed, unreachable | render | docker installed + unreachable, container capabilities `unavailable`; no start/stop VM control rendered |

---

## Coverage summary

- Requirements covered: 23/23 (managed-services 8 ADDED + 2 MODIFIED, service-secrets 1 MODIFIED, settings-panel MODIFIED (view, page-id registry, Save Bar), services-settings-ui 9 ADDED)
- Scenarios by class: edge 35 · perf 0 · frontend 17 · error 13
- Scenarios by level: L1 50 · L2 0 · L3 14 · manual-only 1
- Scenarios by disposition: automated 64 · manual-only 1

## New infra needed

- none. L3 uses user-origin `attached` services (`node -e` scripts) inside the existing docker harness; OCI behaviour is covered in L1 with recorded docker/podman CLI output fixtures (gate answer).
