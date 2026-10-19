# Test Plan — add-vault-reach-all-projects

Stage: design   Generated: 2026-10-18

The hard gate passed. Three clarifications were answered and folded into `specs/vault-reach/spec.md`:
- **C1.** "Not now" re-arms when the session reports a different provider.
- **C2.** The pairing dialog shows "Vault unavailable — can't list what this device will get" when the vault is unreadable, and approval stays possible.
- **C3.** The offer for a pool binding widens the pool as-is.

Inherited: the 5 s delivery propagation bound (`credential-delivery`), local precedence (`credential-delivery`, `vault-llm-delivery`).

Hub-first: no scenario asserts remote delivery. The paired-device rows assert the refusal (`transport-insecure`) and the wording only.

Exemplars:
- **L1 server:**
  - `packages/server/src/__tests__/vault-grants.test.ts` (resolution, revocation);
  - `vault-delivery-trust.test.ts` (trust gate);
  - `vault-delivery-wiring.test.ts` (hub ↔ bridge messages);
  - `vault-routes.test.ts` (authority, response shape);
  - `vault-plugin-read.test.ts`.
- **L1 bridge:** `packages/extension/src/__tests__/vault-delivery.test.ts`.
- **L1 client:**
  - `packages/client/src/components/session/__tests__/VaultBindingsChip.test.tsx`;
  - `packages/client/src/components/pairing-approval/__tests__/PairingApprovalDialog.test.tsx`.
- **L3:**
  - `tests/e2e/vault-session-bindings.spec.ts` (chip, session state);
  - `tests/e2e/vault-settings.spec.ts` (vault page);
  - `tests/e2e/pairing-approval-dialog.spec.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | vault-reach: Reach "All my projects" | EP | L1 | automated | `GEMINI_API_KEY` has an `all` grant, default "personal"; hub session in `/tmp/never-seen` (no grant, no remote) | `resolveBindings` | one resolution `{ name: GEMINI_API_KEY, state: granted, accountId: personal, source: reach }` |
| E2 | credential-delivery: Delivery only to granted sessions on trusted devices | decision-table | L1 | automated | `all` grant on `SONIOX_API_KEY`; origins: local, paired device with `isTls` false, unattributed remote | `handleSyncRequest` for each | local → snapshot carries SONIOX_API_KEY; paired → outcome `transport-insecure`, no entries; unattributed → `untrusted`, no entries |
| E3 | vault-reach: Reach exceptions (precedence) | decision-table | L1 | automated | `anthropic` (single, default "personal", reach all); repo session `github.com/robson/deck3d` with rows: (a) repo grant account "work", checkout confirmed; (b) same, unconfirmed; (c) repo grant with revoked account; (d) no grant + `dir:` exclusion for this checkout; (e) no grant, no exclusion | `resolveBindings` per row | (a) granted "work", source grant; (b) `pending-confirmation`, no entry; (c) `no-account`, no entry, no fallback; (d) nothing for `anthropic`; (e) granted "personal", source reach |
| E4 | vault-reach: Reach exceptions (exclusion match) | state-transition | L1 | automated | "Turn off here" stored `dir:hub:/Users/robson/Project/deck3d` for `anthropic` (reach all); session there with repo key `github.com/robson/deck3d` | resolve; then change the session's key to no remote; then to remote `github.com/acme/other` | nothing for `anthropic` in all three states |
| E5 | vault-reach: Reach exceptions (repo exclusion scope) | EP | L1 | automated | `repo:github.com/robson/deck3d` exclusion for `anthropic` (reach all) | sessions in two checkouts of that repo (dirs `/a/deck3d`, `/b/deck3d`) and one unrelated dir | both checkouts get nothing for `anthropic`; the unrelated dir gets "personal" |
| E6 | vault-reach: Reach "All my projects" (delivery checks) | EP | L1 | automated | reach all on bindings `PATH` (hand-edited file) and `GEMINI_API_KEY` whose default value has 6 characters | `buildDeliverySnapshot` | `PATH` → `blocked-name`, no entry; `GEMINI_API_KEY` → the same non-delivery state as a grant gives (`too-short` when `absorb-service-secrets-into-vault` landed, else `no-account`); no entry |
| E7 | vault-reach: Reach "All my projects" (revoked default) | state-transition | L1 | automated | `anthropic-work` reach all, default "work", 3 reached projects | `revokeAccount(work)` then resolve each | all three `no-account`; no resolution uses another account |
| E8 | vault-reach: Reach is chosen when an account is added | EP | L1 | automated | `POST /api/vault/grants { subject: "all", bindingName, accountId: "x" }`; and `POST /api/vault/bindings` without reach | requests | first → 400 `invalid_grant`; second → binding created, no `all` grant in the document |
| E9 | vault-reach: Reach exceptions (narrow / re-widen) | state-transition | L1 | automated | reach all with one `dir:` exclusion and one repo account grant | set reach "chosen"; then reach "all" | after narrow: `all` grant gone; exclusion and grant kept. After re-widen: the excluded dir still gets nothing; the grant still applies |
| E10 | vault-reach: Reach "All my projects" (delete) | state-transition | L1 | automated | binding with `all` grant + 2 exclusions + 1 project grant | `deleteBinding` | `grants` and `reachExclusions` hold no entry with that binding name |
| E11 | vault-reach: Reach exceptions (downgrade) | invariant | L1 | automated | document with `{ subject: "all" }` grants and `reachExclusions` | pre-change `applicableGrants` logic (repo-or-dir key match) run over 100 random project keys | never returns an `all` grant; `reachExclusions` never appears in `doc.grants` |
| E12 | credential-vault: Checkout confirmation for repository grants | decision-table | L1 | automated | spoofed-origin dir claiming `github.com/acme/app`, unconfirmed; bindings: `A` with reach all, `B` with repo grant only | resolve | `A` granted, source reach; `B` `pending-confirmation` |
| E13 | vault-reach: Reach "All my projects" (service + plugin) | EP | L1 | automated | `GEMINI_API_KEY` reach all; a `service:transcribe` read; a plugin declaring `GEMINI_API_KEY` without approval | service resolution; `createPluginVaultReader(...).read` | service gets nothing (no `service:` grant); plugin read returns undefined (not approved) |
| E23 | vault-reach: Reach is chosen when an account is added (import) | EP | L1 | automated | import proposal with `GEMINI_API_KEY`, `SONIOX_API_KEY`, create-variables on | confirm import | both bindings created; document has no `all` grant |
| E14 | vault-reach: Reach changes are recorded | invariant | L1 | automated | widen, add exclusion, accept offer, undo | emit | each event has `{ at, kind, bindingName, subjectKind, sessionId?, outcome }`; no event string contains `/` or a value |
| E15 | vault-reach: Missing-credential offer (bridge predicate) | decision-table | L1 | automated | stub `ModelRegistry`: (a) `ctx.model` undefined; (b) stage 1 missing, stage 2 undefined; (c) stage 1 missing, stage 2 found; (d) stage 1 configured; (e) `getProviderAuthStatus` absent | `session_start` | (a) no message; (b) `vault_missing_provider { provider: anthropic }`; (c) `{ provider: null }` or none; (d) none; (e) none |
| E16 | vault-reach: Missing-credential offer (bridge cadence) | state-transition | L1 | automated | bridge last sent `{ provider: anthropic }` | (1) `model_select` to another anthropic model; (2) vault sync request; (3) three snapshots applied within 200 ms | (1) no new message; (2) message re-sent unchanged; (3) exactly one message 500 ms after the last snapshot |
| E17 | vault-reach: Missing-credential offer (hub decision table) | decision-table | L1 | automated | `missingProvider: anthropic` with: (a) delivery disabled; (b) outcome `transport-insecure`; (c) `dir:` exclusion for `anthropic`; (d) no binding, accounts "work" and "personal"; (e) binding `anthropic` default "personal"; (f) pool `anthropic`; (g) no usable account | `getSessionState` | (a, b) no `offer`; (c) `offer.claimedBy.state = excluded`; (d) 2 accounts, no binding; (e) `binding.defaultLabel = personal`; (f) binding is the pool; (g) `accounts: []` |
| E18 | vault-reach: Missing-credential offer (viewer) | EP | L1 | automated | session with `missingProvider: anthropic`; caller without `canManageVault` | `GET /api/session/:id/vault-bindings` | body has `missingProvider: anthropic`; no `offer`, `accounts` or `binding` key anywhere in the JSON |
| E19 | vault-reach: Missing-credential offer (accept) | decision-table | L1 | automated | accept `scope: all` with: (a) no binding, OAuth "work" (anthropic, lease-verified); (b) binding default "personal", `accountId` omitted; (c) key account for `openai`; (d) OAuth account of a non-lease-verified provider; (e) offer `claimedBy` | `POST /api/vault/offer/accept` | (a) `llm` binding `anthropic`, delivery `lease`, default work, `all` grant; (b) default still personal, `all` grant added; (c) binding `openai`, delivery `key`; (d) 400 with the reason, document unchanged; (e) 409, document unchanged |
| E20 | vault-reach: Missing-credential offer (idempotent) | state-transition | L1 | automated | accepted `scope: all` | same accept again | 200, document byte-identical, undo record unchanged |
| E21 | vault-reach: Missing-credential offer (Undo window) | BVA (clock) | L1 | automated | accepted at t0 (offer created binding `anthropic`) | undo at t0+9:59; separately at t0+10:01; after an edit to the binding's default; after a hub restart; from a non-manager | 9:59 → binding and `all` grant removed; 10:01 → 410 `gone`; edited → 409 `conflict`; restart → 410 `gone`; non-manager → 403; document unchanged in every refusal |
| E22 | vault-reach: Missing-credential offer (project scope) | EP | L1 | automated | repo session, unconfirmed checkout | accept `scope: project` | `repo:` grant created; response `state: pending-confirmation` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | vault-reach: Reach is chosen when an account is added | state-transition | L3 | automated | harness with an anthropic subscription; an existing binding `GEMINI_API_KEY` | open Providers → "Another account" anthropic; Vault → Add key `gemini` creating new `ASSEMBLYAI_API_KEY`; Add key whose variable `GEMINI_API_KEY` exists | the first two show `vault-reach` with "All my projects" checked; the third shows no `vault-reach` control |
| F2 | vault-reach: Reach is chosen (widening confirmation) | state-transition | L3 | automated | binding `anthropic-work` with reach "Only projects I choose" | click "Make it available to all my projects" → Cancel; again → confirm | after Cancel the card shows "Only projects I choose" and the document has no `all` grant; the confirm text names the devices and "cloned"; after confirm the card shows "All my projects" |
| F3 | vault-reach: Variable cards show the reach | state-convergence | L3 | automated | `anthropic-work` reach all, 1 account exception, 1 exclusion, 2 open sessions receiving it | open Vault → Variables | `vault-reach-all` shows "2" projects; the exceptions list has exactly 2 rows |
| F4 | vault-reach: Missing-credential offer (accept + Undo) | state-transition | L3 | automated | hub session in a new folder, no Anthropic credential (harness pi without `auth.json` anthropic), vault account "work" | banner "Use in all my projects" → then Undo | before click the banner text names the hub and contains "cloned"; within 5 s of accept the chip lists `anthropic` "From All my projects" and the banner shows Undo; after Undo the vault has no `anthropic` binding and the banner offers again |
| F5 | vault-reach: Missing-credential offer (viewer) | EP | L3 | automated | the same session viewed with an observe-tier browser | load session | banner says an operator can share a login; no button; the bindings response has no `offer` key |
| F6 | vault-reach: Session view names where access comes from | state-transition | L3 | automated | session receiving `anthropic` via reach and `GEMINI_API_KEY` via a dir grant | open chip; "Turn off here" on `anthropic` | the `anthropic` row says "From All my projects" with "Turn off here"; the `GEMINI_API_KEY` row says "Granted to this project" with no "Turn off here"; within 5 s `anthropic` leaves the session and a `dir:` exclusion exists |
| F7 | vault-reach: Pairing discloses the reach | decision-table | L3 | automated | reach-all bindings `anthropic`, `GEMINI_API_KEY`; (a) healthy vault; (b) corrupt vault file | open the approval dialog for a pending device | (a) lists both names under "This device will get" with "once remote delivery is on", no value; (b) shows "Vault unavailable — can't list what this device will get", and Approve is enabled |
| F8 | vault-reach: Missing-credential offer (shared poll) | invariant | L1 | automated | chip and banner both mounted for one session | advance 3 poll intervals | `GET /api/session/:id/vault-bindings` called exactly 3 times |
| F9 | vault-reach: Missing-credential offer (empty session) | EP | L1 | automated | state with `bindings: []`, no `ungranted`, `offer` present | render the session view | the chip renders nothing; the banner renders the offer |
| F10 | vault-reach: Missing-credential offer ("Not now") | state-transition | L1 | automated | offer for `anthropic`; "Not now" clicked | reported provider stays `anthropic` (model switch within anthropic); then becomes `openai` with an offer | hidden while `anthropic`; the `openai` offer shows |
| F11 | vault-reach: Impact lists include the reach | state-convergence | L3 | automated | `anthropic-work` reach all, default "work", 4 open projects receiving it | start revoking account "work" | the impact lists "all projects", names the 4 open projects, and offers to pick another default |
| F12 | vault-reach (all surfaces) | visual/subjective | — | manual-only | built surfaces vs `mockups/reach.html` | human side-by-side in base dark, base light and nord dark | [judgment: the render matches the approved board; the probes are automated in F13] |
| F13 | vault-reach (all surfaces) | invariant | L3 | automated | the F1–F7 and F11 states | computed-contrast probes (`tests/e2e/helpers/computed-contrast.ts`) in base dark, base light, nord dark at 375 and 1440 | contrast, size and focus failure lists empty |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | vault-reach: Missing-credential offer | fault-injection | L1 | automated | vault file corrupt | `getSessionState` with `missingProvider`; then accept | no `offer`; accept → 503 with a content-free error, nothing written |
| X2 | vault-reach: Missing-credential offer | fault-injection (abort) | L1 | automated | `store.update` throws during accept | accept | 500 with a content-free error; no undo record; the document is unchanged |
| X3 | vault-reach: Missing-credential offer | fault-injection (restart) | L1 | automated | hub instance replaced (restart) while the bridge's last-sent state is `{ provider: anthropic }` | bridge reconnects (sync request) | the new hub has `missingProvider: anthropic` and computes the offer, with no model change |
| X4 | vault-reach: Missing-credential offer (T0 equivalence) | fault-injection | L1 | automated | real pi `ModelRegistry` in a temp agent dir, one case per source: `auth.json` entry; env var set after the snapshot; `models.json` apiKey; `providers.json`; vault env delivery (`process.env`); vault `llm` `registerProvider` override; none | evaluate the bridge predicate and call pi's prompt gate | the predicate says "missing" exactly when pi's gate refuses; on any mismatch, T0 records the fallback decision (design D3) |
| X5 | vault-reach: Missing-credential offer | fault-injection | L1 | automated | pi without `getProviderAuthStatus` (older build stub) | `session_start` | no `vault_missing_provider` message; no error thrown |

---

## Coverage summary

- Requirements covered: 12 of 12:
  - `vault-reach`: 9;
  - `credential-vault` (MODIFIED): 2 (E1, E12);
  - `credential-delivery` (MODIFIED): 1 (E2).
- Scenarios by class: edge 23 · perf 0 · frontend 13 · error 5
- Scenarios by level: L1 31 · L2 0 · L3 9 · manual 1
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- **L3 harness session without an Anthropic credential (F4, F5).** It needs a pi agent dir with no anthropic credential in the docker harness. Check during apply whether `vault-session-bindings.spec.ts` can seed one; otherwise add a fixture HOME.
