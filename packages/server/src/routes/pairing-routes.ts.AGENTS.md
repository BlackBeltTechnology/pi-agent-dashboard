# pairing-routes.ts — index

Server-identity challenge + device-pairing routes. Exports `registerPairingRoutes`, `PUBLIC_PAIRING_PREFIXES`. PUBLIC (device-facing, auth-exempt): `POST /api/pair/challenge` (signed-nonce identity proof), `/redeem` (code→pending+confirm code), `/poll` (collect bearer). AUTH (networkGuard): `GET /api/pair/payload`, `GET /api/paired-devices`. OPERATOR (`operatorGuard`): `POST /api/pair/approve` (D12 typed compare-code), `DELETE /api/paired-devices/:id`, plus `POST /api/paired-devices` — DIRECT device-token mint (operator-only, D5): `operatorGuard` admits login session (`authVia === "session"`) / `X-Pi-Local-Token` / `isGenuinelyLocal`, AND unconditional `isHostAdmitted` enforce semantics regardless of the global gate mode (closes DNS rebinding); device bearer + trusted-network-only REFUSED (X4/X5). Label: `typeof string`, trim, `MAX_DEVICE_LABEL_BYTES = 64` UTF-8 bytes → 400 BEFORE `registry.add(label, "manual")`. Response `200 { success, data: { device, token } }`, plaintext-once. NOT in `PUBLIC_PAIRING_PREFIXES`. NOT exported standalone guard — `createOperatorGuard({localToken, hostAdmission})` exported for tests. server.ts wires `localToken` + live `hostAdmission()` (`getHostGateCtx().admission`). See change: add-server-keypair-pairing, mcp-legacy-clients-and-token-issuance.

## add-pairing-approval-dialog

`/redeem` passes `User-Agent`/`Host`/`request.ip`/`X-Forwarded-For` into `pairing.redeem(code, meta)`. New operator-only routes (ALL `preHandler: operatorGuard`, never `networkGuard` — paired-device bearer refused): `GET /api/pair/pending` (`listPending()`), `POST /api/pair/approve-pending {pendingId, confirmCode, label?}` (label validated by `validLabel` 1..`MAX_DEVICE_LABEL_BYTES` UTF-8 bytes BEFORE delegating → 400; `approveFailure` maps `locked_out` 429, `no_pending` 404, else 400; mismatch body carries `attemptsLeft`), `POST /api/pair/deny {pendingId}` (200 | 404 `no_pending`). `/api/pair/approve` status codes unchanged; mismatch body gains additive `attemptsLeft`. Mint route reuses `validLabel`. See change: add-pairing-approval-dialog.

## harden-server-request-surfaces

`createOperatorGuard` short-circuits `authVia === "device"` → 401 BEFORE the session / local-token / `isGenuinelyLocal` clauses — device bearer refused on credential strength alone, any network position; mint route inherits (E15). `DELETE /api/paired-devices/:id` swaps `networkGuard` → `operatorGuard` (E10–E12); operator on non-admitted Host → 403 `host_not_admitted` enforce semantics (X5). `/api/pair/approve` label: key present + non-string → 400 `label must be a string`; string → `validLabel` (trim, empty or >64 UTF-8 bytes → 400 `label must be 1..64 UTF-8 bytes`); absent key → `undefined` keeps pending label; trimmed value passed to `pairing.approve`. Validation route-level, NOT in `PairingManager` (no HTTP status vocabulary). Tests: `pairing.test.ts` D2 block (E10–E24, X5). See change: harden-server-request-surfaces.

Operator guard reads `hasLocalCredential(headers)`. See change: loopback-credential-proof (D4).

`POST /api/pair/request` — public knock route, listed in `PUBLIC_PAIRING_PREFIXES` (no operator guard). JSON-only (non-JSON → 415). Source address read from the raw socket peer, NEVER `request.ip` (XFF is attacker-controlled on a LAN knock). `approve-pending` takes an optional validated `tier`. New deps `getAcceptLanRequests`, `getLanInterfaces`. Tests: `__tests__/pair-request-route.test.ts`. See change: add-lan-knock-pairing.

## fix-pairing-approval-credential

Approval guard 401 (device bearer AND no-credential) sends `describeApprovalRefusal` body (`reason`, `remedies`; guard order unchanged, credential check before Host check); non-admitted Host or helper failure → legacy `{success,error}`. `POST /api/pair/deny` moved `operatorGuard` → `approvalGuard`; `GET /api/pair/pending` stays `operatorGuard`. New optional dep `loginAvailable` (shared thunk from `server.ts`); config port from `getPort`, absent ⇒ no `authorize-browser`. Tests: `pairing-refusal-remedies.test.ts`, `pairing-approval-dialog.test.ts`. See change: fix-pairing-approval-credential.

## add-request-access-remedy

Knock route builds its admission input with `knockPeerInput(request)` and spreads `knockPeerState({hostAdmission, getLanInterfaces})` into the `admitKnock` state; `headerString` now imported from `pairing/knock-admission.ts`. Behaviour unchanged (`pair-request-route.test.ts` green unchanged).

Passes `getKnockEligibleNetworks` (raw trusted list) into `knockPeerDeps`/`KnockPeerDeps`. See change: retire-trusted-networks-bypass.
