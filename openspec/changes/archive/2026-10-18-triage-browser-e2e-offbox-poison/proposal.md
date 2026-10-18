## Why

Issues: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/832 (primary), https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683 (residual red baseline, triage only), https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/862 (nightly red).

`ci-e2e-browser.yml` shard 10 never finishes (>95 min, cancelled on runs 37757227913 / 37767829565 / 37774099186). After `mcp-client-harness-integration.spec.ts` X23 every later test fails and the per-test reap logs `OffBoxError: ticket mint denied: off-box / untrusted network needs device pairing (loopback-only MVP)`.

Two of the issue's claims do not survive contact with the code:

- **X23 does not mutate server trust state.** It intercepts every route it exercises (`tests/e2e/mcp-client-harness-integration.spec.ts:164-173`); the toggle write is fulfilled by Playwright and never reaches the server. X23 is where the poisoning becomes *visible*, not necessarily where it is *caused*.
- **The log line cannot name the cause.** The bus client collapses HTTP 401 and 403 into one fixed message and discards the guard's self-describing body (`packages/bus-client/src/client.ts:131-133`), so "off-box" is the client's guess, not the server's verdict.

What IS structural, and is the same whatever the trigger turns out to be:

1. The docker harness's ONLY pass condition for credential-free callers is the seeded `trustedNetworks: ["0.0.0.0/0"]` in `config.json` (`docker/test-entrypoint.sh:183-221`) — the container never sees a loopback peer. That one global switch is narrowed at runtime by several specs and restored only in `afterAll` (`tests/e2e/mcp-tiered-token.spec.ts:38-46`, `:104-106`; `tests/e2e/helpers/operator-session.ts:43-69`). A worker that times out, crashes or is cancelled between arm and restore poisons every later spec in the shard, with no way back — a hazard `tests/e2e/network-guard.spec.ts:14-22` already documents in prose.
2. The harness-down latch probes `/api/health` (`tests/e2e/fixtures.ts:83-89`), the one endpoint that is a public in-namespace exception to the guard (`packages/server/src/auth/localhost-guard.ts:466-480`; asserted green-while-untrusted by `tests/e2e/network-guard.spec.ts:68-71`). A refusing-but-alive harness is therefore structurally invisible to the latch: 50+ later tests each burn a 60 s timeout plus a CI retry (`playwright.config.ts:39`, `:49`) instead of the run failing fast.

#862 is unrelated to #832 and is NOT what the issue body says. The nightly's real failures (run 38504381607, job 115658811634) are two budget overruns: `coverage-report.test.mjs` E2 times out at 600 s because it spawns a full v8-instrumented repo run (measured 736 s), and `dependency-declarations.test.mjs` P1 measured 122.2 s against a flat 120 s ceiling.

## What Changes

- Make a mint denial self-describing: the bus client carries the HTTP status and the guard's machine-readable `error` as typed fields (and renders the human `reason` in the message) instead of a fixed "off-box" string, so the next red CI run names its own cause and the suite can branch on it without parsing text.
- Add a refusal-aware harness latch: a harness that answers `/api/health` but refuses the suite's own client by **harness policy** — a 403 whose `error` is `network_not_allowed` or `host_not_allowed` — at the reap pre-snapshot (today's swallow point) is declared unusable once, loudly, and the remaining specs are skipped instead of each timing out. The verdict is armed only for an *unexpected* refusal: it is disarmed for a run whose recorded boot baseline already refuses the credential-free client (narrow-booted leg), and while a narrowing declared through `narrowTrust` is active (including describe-scope, e.g. `lan-knock`), where the pre-snapshot is skipped with a note. A 401, any other 403 (e.g. identity `forbidden`) and a transport error do not latch; the denials fail the observing test with their status and literal.
- Give harness-global trust narrowing per-test isolation: one `narrowTrust` helper (test or describe scope; a `touches:` form declares keys changed through the UI) whose test-scope restore is drained inside the existing reap fixture after the test body (runs on timeout/failure, unlike `afterAll`, and needs no fixture-ordering assumption), **plus a worker-start re-assertion of the harness's own boot baseline** (recorded once in globalSetup, so a harness booted narrow is never widened) for the case teardown cannot cover (worker killed by OOM/signal/cancellation — the observed #832 vector), plus a per-test tripwire over the named trust-bearing keys that attributes a leaked narrowing to the spec that caused it. A repo lint over `tests/e2e` writes of trust-bearing keys is the source of truth for the migration list (today eight specs/helpers: `mcp-tiered-token`, `mcp-token-settings`, `helpers/operator-session`, `lan-knock`, `gateway-url-action`, `host-gate-allow`, `access-grant-dialog`, `preview-denial-remedy`). Restore and tripwire use an operator credential, since a narrowed harness refuses the credential-free client; that credential exists only with `auth` configured (`PI_E2E_OAUTH=1`, managed default), so on a no-auth harness runtime narrowing fails the calling test and such specs must run on a dedicated narrow-booted leg.
- Reproduce/bisect #832 with the instrumentation above in place (task 4, explicit decision points — a baseline dispatch on unmodified `develop` first, then an instrumented one) and fix the trigger if it is a product defect.
- Fix the two #862 budgets: bound the live coverage scenario against a new fixture that owns a deliberately unloaded source file, and replace the publish-checker's flat ceiling with `30 + 3 * N` seconds, N = the workspace set the checker walks incl. the non-private root (57 today → 201 s) (the main spec says 60 s, the test asserts a flat 120 s, CI measured 122.2 s — drift resolved here).
- **Spec-sync correction (no behaviour change):** the `PI_E2E_SEED` requirement still describes the RFC1918 trusted-network seed the entrypoint abandoned; `docker/test-entrypoint.sh:186-221` has seeded any-peer (`0.0.0.0/0`) with a `PI_E2E_TRUSTED_NETWORKS` override since the VPN-peer fix. This change brings the written spec back to the shipped behaviour, because the trust baseline it describes is exactly what tasks 2-3 restore and tripwire against.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec/specs/playwright-e2e-qa/spec.md` — MODIFIED: the harness-unusable latch covers harness-policy refusal (`network_not_allowed`, `host_not_allowed`), not only death, and does not fire on 401s, other 403s or transport errors. MODIFIED: the `PI_E2E_SEED` trust seed is restated as the any-peer-plus-override behaviour already shipped in `docker/test-entrypoint.sh` (spec-sync correction, no code change). ADDED: trust-bearing configuration a spec narrows is changed only through the declared mechanism (lint-enforced), restored after the test body (or at group end for describe scope), re-asserted from the boot baseline at worker start, and tripwired per test.
- `openspec/specs/dashboard-bus-client-connection/spec.md` — MODIFIED: mint rejection carries the server's status and machine-readable error as typed fields, renders the human reason, and survives a non-JSON body.
- `openspec/specs/test-coverage-reporting/spec.md` — ADDED: the live coverage scenario check is bounded by a ceiling derived from its measured scoped runtime (≥1.5x headroom), runs against a fixture owning a permanently unloaded file, and must not re-run the instrumented repo suite.
- `openspec/specs/publish-correctness-verification/spec.md` — MODIFIED: the CI time budget is stated once as `30 + 3 * N` seconds over the checker's own walked workspace set, and is the number the test computes and asserts.

## Discipline Skills

- `systematic-debugging` — task 4 is a bisect with decision points; no fix lands before the trigger is named or the search is exhausted.
- `security-hardening` — the suspected trigger is a change in how the server classifies a caller's network trust; any product-side fix touches the guard.
- `observability-instrumentation` — the denial diagnostic (status + reason + latch verdict) is the deliverable that makes the next run decisive.
- `review-code` — before commit.

## Non-goals

- Fixing #683's quarantined specs (101 `test.fixme` references across 44 files at the time of writing; re-derive with `grep -rc 'issues/683' tests/e2e --include=*.ts`, the issue says ~33). They are triaged into clusters in `design.md` and handed to follow-up changes; only a cluster proven to share this change's root cause may be unquarantined here, where "proven" means the spec's original #683 failure log shows the refusal/off-box signature (not a geometry or assertion failure) and it passes in ≥ 3 consecutive dispatched runs after the fix (task 5.5).
- Changing the harness's trust model (loopback-only MVP, device pairing, identity plane). This change constrains what the *test suite* may do to it and how a refusal is reported.
- Re-sharding or re-timing the browser-E2E workflow.

## Impact

- `tests/e2e/` fixtures and the specs that narrow harness trust; `packages/bus-client/` error reporting; `scripts/__tests__/` budgets. A server-side fix in `packages/server/src/auth/` is possible but is gated on task 4's verdict.
- **Migration:** none for users. `OffBoxError` keeps its class and `off-box` code; it gains optional `status`/`error` fields and a richer message, and the denial path newly reads the response body (safe-parsed, so a non-JSON denial still yields the status-only error), so string-matching consumers in tests are the only breakage surface (`packages/bus-client/src/__tests__/offbox-ticket-denied.test.ts`). The `PI_E2E_SEED` spec edit is documentation catching up to shipped code; no harness behaviour changes with it.
- **Compatibility:** the suite changes are test-only. If task 4 finds a product defect, that fix carries its own compatibility note in `design.md` before it lands.
- **Rollback:** revert the commit; the suite returns to today's behaviour (slow poisoned shards), no persisted state is involved.
