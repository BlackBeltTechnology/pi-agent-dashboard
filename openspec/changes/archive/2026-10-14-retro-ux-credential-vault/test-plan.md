# Test Plan — retro-ux-credential-vault

Stage: design   Generated: 2026-10-13

Levels:
- **L1:** vitest. Server tests in `packages/server/src/__tests__/*.test.ts`; client tests in `packages/client/src/**/__tests__/*.test.tsx` and `packages/client/src/lib/**/__tests__/*.test.ts`.
- **L2:** `qa/tests/*.sh`, process smoke, no rendered-UI asserts.
- **L3:** Playwright `tests/e2e/*.spec.ts` in the docker harness. The port comes from `.pi-test-harness.json` and is never hardcoded.

Fixture names below are the board's (`mockups/vault.html`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | credential-vault: Project picker (store cap) | BVA (count 199/200/201) | L1 | automated | store holding 199, then 200 entries (distinct `(deviceId, dir)`, ascending `lastSeenAt`) | `record()` one new project each time | after the 200th: 200 entries; after the 201st: 200 entries and the oldest `lastSeenAt` key is gone |
| E2 | credential-vault: Project picker (per-device cap) | BVA (count 100/101) | L1 | automated | 100 entries for device `hub`, 50 for device `mac-mini-iroda` | `record()` a 101st `hub` project | `hub` holds 100 entries (its oldest evicted); `mac-mini-iroda` still holds 50 |
| E3 | credential-vault: Project picker ("Remembered list is bounded") | BVA (age 89 d / 90 d / 90 d + 1 ms) | L1 | automated | entries with `lastSeenAt` = now − 89 d, now − 90 d, now − 90 d − 1 ms, no write since | `list()` | first two listed, third not listed; file unchanged (no write on read) |
| E4 | design D2: write throttle | BVA (59 min / 61 min) + EP (new key) | L1 | automated | injected `now`; key K recorded at t0 | `record(K)` at t0 + 59 min, at t0 + 61 min; `record(L)` at t0 + 1 s | file writes: none at +59 min, one at +61 min, one for L immediately |
| E5 | design D2: input caps | BVA (4096/4097; 512/513) | L1 | automated | `dir` of 4096 and 4097 chars; `repoKey` of 512 and 513 chars | `record()` each | 4096 / 512 recorded; 4097 / 513 not recorded and no file created if none existed |
| E6 | credential-vault: "Remembering does not create the vault file" | EP (missing file / valid record / invalid record) | L1 | automated | empty temp HOME | `list()`; `record()` an over-long `dir`; then `record()` a valid project | after `list()` and the invalid record: neither `vault-projects.json` nor `vault.json` exists; after the valid record: `vault-projects.json` exists with mode `0600`, `vault.json` absent |
| E7 | design D2: `listOpenProjects` outcomes | decision table (outcome × connected) | L1 | automated | records with outcomes `delivered` (2 sessions, same project), `untrusted`, `transport-insecure` (origin reported), `disabled`, `vault-unavailable`, `no-project`, plus one `delivered` but disconnected | `listOpenProjects()` | one grantable entry with `sessions: 2`; two `blocked` entries listed by `cwd` with no `repoKey`; `disabled`, `vault-unavailable`, `no-project` and the disconnected record absent |
| E8 | credential-vault: "Open session project is offered" / "Project from an earlier session is remembered" | EP | L1 | automated | open: `(hub, /Users/robson/Project/deck3d, github.com/robson/deck3d)`; store: the same key plus `(hub, /Users/robson/scratch)` seen 3 d ago and `(hub, /x)` seen 1 d ago | `GET /api/vault/projects` as operate | `open` has deck3d with `sessions`; `recent` = `[/x, /Users/robson/scratch]` (newest first) and excludes deck3d |
| E9 | credential-vault MODIFIED "Values never leave…" + design D11 | decision table (caller kind × tier × network) | L1 | automated | callers: device operate / device control; session operate / session observe / claim-less session; session observe from a trusted network; principal authorised / principal not authorised by `HostPolicy`; locally trusted; none | `GET /api/vault`, `GET /api/vault/projects`, `POST /api/vault/accounts` | 200 for device operate, session operate, claim-less session, authorised principal, local trust; 403 `operate_required` for every other caller, vault unchanged, no path or name in the body |
| E10 | credential-delivery: "Ungranted names stay private" / "Session without a resolved project offers nothing to grant" | decision table (authority × project) | L1 | automated | bindings `GEMINI_API_KEY` (granted to the session's repo), `OPENAI_API_KEY` (not granted); sessions: resolved project; `transport-insecure` | `GET /api/session/:id/vault-bindings` as operate and as observe | operate + resolved → `ungranted: ["OPENAI_API_KEY"]`; operate + refused → `ungranted: []`; observe → no `ungranted` key; `bindings` identical in all cases |
| E11 | url-routing: SPA fallback (all scenarios) | decision table (path × mode) | L1 | automated | admitted requests `/api/does-not-exist`, `/api`, `/%61pi/x`, `/x/../api/y`, `//api/x`, `/api%2Fx`, `/session/abc-123`, `/api/health`; modes production, dev (Vite stub), no build | Fastify `inject` GET | the first five → 404 `application/json` `{success:false,error:"not_found"}` in every mode; `/api%2Fx` → not JSON 404 (documented limit); `/session/abc-123` → `index.html` 200 (production); `/api/health` → 200 JSON |
| E12 | url-routing: "Unknown API path in development mode" | EP | L1 | automated | dev mode with a stub Vite server counting requests | GET `/api/does-not-exist` | 404 JSON; stub request count 0 |
| E13 | design D7: client mapping | decision table (status × content-type × body) | L1 | automated | replies 200 `text/html`; 502 `text/html`; fetch rejection; 200 `application/json` with body `{oops`; 403 JSON `{success:false,error:"operate_required"}`; 404 JSON `not_found`; 200 JSON success | `fetchVault()` | codes `server_outdated`, `transport` (message has `HTTP 502`), `network`, `transport`, `operate_required`, `not_found`; success returns `data` |
| E14 | credential-vault: "New provider creates its variable" / "Invalid derived name is not offered" / "Existing variable keeps its default unless asked" | EP + decision table (derived name × binding exists × provider match) | L1 | automated | providers `assemblyai` (no binding), `node`, `Google Gemini` (no binding), `gemini` while `GEMINI_API_KEY` defaults to `gemini / personal`, `gemini` while `GEMINI_API_KEY` defaults to `openai / work` | open Add key, fill provider | `ASSEMBLYAI_API_KEY` create option, checked; `node` → no option; `GOOGLE_GEMINI_API_KEY` create option; `gemini` → make-default option unchecked with impact line; provider mismatch → no option |
| E15 | credential-vault: Vault page explains … invalid states (key length) | BVA (7/8 chars) | L1 | automated | key values of 7 and 8 characters | press Add key | 7 → field `aria-invalid="true"` with message, 0 POST calls; 8 → one `POST /api/vault/accounts` |
| E16 | credential-vault: "Reserved name caught at the field" | EP (reserved exact / reserved prefix / valid) | L1 | automated | names `PATH`, `NODE_OPTIONS`, `MY_SERVICE_TOKEN` | press Create in the new-variable form | first two → field invalid with message naming the name, 0 POST; third → one `POST /api/vault/bindings` |
| E17 | credential-vault: "Status is not carried by colour alone" / "Unconfirmed repository grant is visible" | decision table (subject kind × confirmation × account) | L1 | automated | grants: folder ok; repo with 1 confirmation; repo with 0 confirmations; override revoked (`no-account`); no override + binding without default | render the Variables tab | `data-status` = `delivering`, `delivering`, `pending`, `no-account`, `no-default` with matching text; `data-state` only `ok` or `no-account`; `vault-grant-no-account` count 1 |
| E18 | design D1: other subjects | EP | L1 | automated | a grant with subject `service:svc-1` in the overview | render | row shows `service:svc-1` and the pill "Not delivered to sessions"; no delivery status pill |
| E19 | credential-vault: "Plugin asks for a missing variable" + base "Plugin read access…" (revoke) | state | L1 | automated | plugin `demo` declares `POLY_PIZZA_KEY`, no binding, approval present | render; untick `vault-plugin-approve` in `vault-plugin-demo-POLY_PIZZA_KEY` | row shows "Create POLY_PIZZA_KEY"; switch was checked; one `DELETE /api/vault/plugin-approvals/demo/POLY_PIZZA_KEY` |
| E20 | credential-vault: "Existing grant is not overwritten" | EP (SSH / HTTPS / case variants) | L1 | automated | grant `repo:github.com/acme/app` for `GEMINI_API_KEY` with account "work" | manual entry `git@github.com:acme/app.git`, then `https://GitHub.com/acme/app` | both → "already has this variable" message, 0 `POST /api/vault/grants` |
| E21 | credential-vault: "Refused session is shown, not offered" | EP | L1 | automated | `fetchVaultProjects` returns a `blocked: transport-insecure` entry for `/home/robson/edge-lab` | open the picker | option disabled with the reason text; no repository key text; selecting it is impossible |
| E22 | credential-vault: "Import creates same-name variables" | decision table (binding exists × name valid) | L1 | automated | proposal `GEMINI_API_KEY`, `SONIOX_API_KEY` (binding exists) and `LD_HACK` (reserved prefix `LD_`) | Import with the variable option ticked | `createBinding` called once, for `GEMINI_API_KEY` with the created account id; `SONIOX_API_KEY` untouched; `LD_HACK` listed as "no variable: reserved name" |
| E23 | credential-delivery: "Pending confirmation is the primary action" | EP (N = 1 / 3) | L1 | automated | session state with 1, then 3 bindings `pending-confirmation` and 1 `delivered` | open the chip dialog | button text "Confirm and deliver 1 key" / "… 3 keys"; callout text contains the repo key, dir, device and "Applies to every session in this checkout"; chip `data-pending="true"` |
| E24 | credential-delivery: Session shows its bindings (labels) | EP (state enum) | L1 | automated | rows `delivered`, `local-override`, `inherited`, `no-account`, `blocked-name`, `revoked`, `hub-unreachable`, `vault-unavailable`, `made-up-state` | open the dialog | each `vault-binding-state` textContent equals the bare label (e.g. "Hub unreachable"); each row has an explanation sibling; `made-up-state` shows its label as explanation; computed font-size of rows, explanations and `vault-last-contact` ≥ 12 px |
| E25 | design D4: chip visibility | decision table (bindings × ungranted) | L1 | automated | `{bindings: [], ungranted: undefined}`, `{bindings: [], ungranted: []}`, `{bindings: [], ungranted: ["OPENAI_API_KEY"]}`, `{bindings: [1 row]}` | mount the chip | hidden, hidden, shown, shown |
| E26 | credential-delivery: "Operator grants a missing variable from the session" | EP (repo key present / absent) | L1 | automated | project `{deviceId: hub, dir: /work/app, repoKey: github.com/acme/app}`; then `{deviceId: hub, dir: /work/scratch}` | click `vault-grant-from-session` for `OPENAI_API_KEY` | POST body subject `repo:github.com/acme/app`; then `dir:hub:/work/scratch`; the repo row showed "Repository grants need this checkout confirmed" |
| E27 | ui-i18n-coverage + design D9/3.9 | EP | L1 | automated | every `vault.*` key referenced by `settings/vault/*.tsx` and `VaultBindingsChip.tsx` | `npm run i18n:parity` and the i18n unit test | every key present in en, zh-CN and hu; parity reports 0 missing |
| E28 | all surfaces: contract probes | decision table (state × theme × width) | L3 | automated | every vault board state as a `page.route` fixture (`tests/e2e/fixtures/retro-ux/vault.ts`); themes `{base,dark}`, `{base,light}`, `{nord,dark}`; widths 375/768/1440 | `captureStates` without `RETRO_UX_CAPTURE` | every `contrast`, `size`, `focus` list empty; no file written under `openspec/` |
| E29 | proposal: protected testids | regression | L3 | automated | the docker harness with a seeded vault (`tests/e2e/vault-settings.spec.ts` F1/F5 seeds) | run `vault-settings.spec.ts`, `vault-session-bindings.spec.ts`, `vault-redaction.spec.ts` after the 3.10 edits | all pass; no testid or `data-state` assertion edited |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D2 throttle + credential-delivery 5 s budget | load (fan-out) | L1 | automated | 200 connected trusted sessions across 200 projects, injected `now`; two store-change pushes 10 min apart | first push ≤ 200 file writes, second push 0 writes; each push sends all 200 snapshots before its promise resolves, in < 5 s wall time | two pushes |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | design D1: APG tabs, panels mounted | state-transition | L1 | automated | populated overview; Accounts add form with provider `gemini` typed | focus the tablist; ArrowRight ×2, Home, End; switch to Variables and back to Accounts | focus and `aria-selected` follow the keys; inactive panels have `hidden` but stay in the DOM; the typed provider value is kept |
| F2 | credential-vault: "First run guides the user" | decision table (accounts × bindings × candidates) | L1 | automated | `{0,0, 2 candidates}`, `{0,0, 0 candidates}`, `{1 account, 0 bindings}` | render | guide with "Import keys" primary; guide with "Add a key" primary; no guide (Variables empty text + New variable) |
| F3 | design D8: loading | async convergence | L1 | automated | `GET /api/vault` held pending, then resolved | mount, then resolve | skeleton with `aria-busy="true"` while pending; replaced by the tablist; never an empty page in between |
| F4 | design D4/D5: repo grant from the chip | async convergence (fake timers) | L1 | automated | session with repoKey, `ungranted: ["OPENAI_API_KEY"]`; after the POST the next poll returns `OPENAI_API_KEY` as `pending-confirmation` | click Grant, advance 2.5 s | the confirm callout appears after exactly one poll; `OPENAI_API_KEY` leaves the ungranted section |
| F5 | credential-vault: "Deleting a binding lists what it removes" (fresh read) | state-transition | L1 | automated | first overview: `GEMINI_API_KEY` with 2 grants; second overview (re-fetch): 3 grants | click Delete | impact lists 3 projects; binding deleted only after Delete variable; Cancel → 0 DELETE calls |
| F6 | design D6: focus | state-transition | L1 | automated | Revoke on account "gemini / work" | open the confirm; press Escape | Cancel focused on open; after Escape the callout is gone and focus is on the Revoke trigger |
| F7 | visual fidelity to the approved board | visual/subjective | — | manual-only | real render (`RETRO_UX_CAPTURE=1` → `mockups/after/`) vs `mockups/vault.html` proposed column | human side-by-side review | [judgment: the render matches the approved design; no automatable observable beyond the probes] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | credential-vault: "Server older than the page" | fault-injection (wrong content) | L1 | automated | `GET /api/vault` → 200 `text/html` `<!DOCTYPE html>…`; `POST /api/restart` → 403 | mount; click Restart server | callout text "doesn't have the vault yet", Restart server and Try again present, no "HTTP 200" text; after the 403 the refusal message shows in the callout |
| X2 | credential-vault: Vault page explains … (unreachable) | fault-injection (abort) | L1 | automated | `fetch` rejects `TypeError` | mount | `vault-error` contains "Can't reach the dashboard server" |
| X3 | credential-vault: "Older server cannot list projects" | fault-injection (wrong content / missing route) | L1 | automated | `GET /api/vault/projects` → 200 HTML; then → 404 JSON `not_found` | open the picker | both: lists hidden, "can't list projects yet" text, manual entry open |
| X4 | credential-vault: "Partial failure is reported" | fault-injection (abort second call) | L1 | automated | `POST /api/vault/accounts` ok; `POST /api/vault/bindings` → 409 | Add key with the create option, then Retry after the overview shows the binding with this account as default | message "Key saved; the variable wasn't created", account listed; Retry → success, no second account POST |
| X5 | design D3: import partial | fault-injection (abort one of N) | L1 | automated | import of 2 names; `createBinding` for the second rejects | Import | done callout names the created variable and the failed one; 2 accounts exist |
| X6 | credential-vault: "Corrupt vault disables writes" + design D8 | fault-injection (corrupt) | L1 | automated | overview `status.state = "corrupt"`; chip session state `outcome: "vault-unavailable"` with ungranted names and a pending binding | render the page and the chip dialog | every add / rotate / revoke / grant / delete / approve control has `disabled`; chip Grant and Confirm `disabled`; backup path shown |
| X7 | design D2: corrupt projects file | fault-injection (corrupt file) | L1 | automated | `vault-projects.json` containing `{oops` | `list()`, then `record()` a valid project | `list()` → `[]`; a `vault-projects.json.corrupt-*` copy exists; after `record()` the file parses and holds 1 entry |
| X8 | design D2: record failure isolation | fault-injection (throw) | L1 | automated | `projects.record` rejects with an error whose message contains `/secret/path` | trusted session sync | outcome `delivered`, snapshot sent; one log line `[vault] project record failed: <name>` without `/secret/path` |
| X9 | credential-vault: Destructive actions (re-read fails) | fault-injection (abort) | L1 | automated | first `GET /api/vault` ok; the re-fetch on Revoke rejects | click Revoke | callout shows the error; "Revoke account" disabled; Retry re-fetches; Cancel works; 0 DELETE calls |
| X10 | design D7 / task 2.6: QA script on a server with the fix | fault-injection (missing endpoint) | L2 | automated | dashboard process whose `/api/tunnel-readiness` route is absent (404 JSON `not_found`) | run `qa/tests/20-tunnel-readiness-perf.sh` | exit 1 with the "server predates the readiness endpoint" diagnostic; no "200 text/html" wording in the output |
| X11 | url-routing: unknown path in the real server | fault-injection (missing route) | L3 | automated | docker harness (production build) | `request.get("/api/does-not-exist")`, then `request.get("/api/plugins/demo/vault-read")` with operator headers | first: 404 `application/json`, `error: "not_found"`; second: 200 JSON (registered plugin route unaffected) |

---

## Coverage summary

- Requirements covered:
  - `credential-vault`: 6/6 (5 ADDED, 1 MODIFIED)
  - `credential-delivery`: 1/1 (MODIFIED)
  - `url-routing`: 1/1 (MODIFIED)
  - design D1–D11: all referenced
- Scenarios by class: edge 29 · perf 1 · frontend 7 · error 11
- Scenarios by level: L1 43 · L2 1 · L3 3 · — 1
- Scenarios by disposition: automated 47 · manual-only 1

## New infra needed

- `tests/e2e/fixtures/retro-ux/vault.ts`: fixture module for E28 on the existing `ui-capture.ts` harness. It follows the existing pattern; no new harness.
- `packages/client/src/lib/vault/__tests__/vault-api.test.ts` and `packages/server/src/__tests__/vault-projects.test.ts`: new files in existing vitest projects.
