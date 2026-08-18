## 1. Package scaffold and vault

- [ ] 1.1 Create `packages/keysync-server/` workspace with `bin` entry, register in `pnpm-workspace.yaml`, add better-auth, SQLite driver and libsodium deps
- [ ] 1.2 Write the SQLite schema and migration runner: members, member keys, accounts, account health, settings, audit
- [ ] 1.3 Test: migration failure aborts startup without binding the port; fresh database creates the full schema
- [ ] 1.4 Implement envelope encryption — per-account DEK wrapped by a boot-supplied KEK
- [ ] 1.5 Test: stored accounts contain no plaintext token; a mismatched KEK reports the mismatch instead of serving
- [ ] 1.6 Implement startup config validation; refuse to start when the KEK is absent, naming the missing key
- [ ] 1.7 Add the dockerfile and verify unattended restart with the KEK from the environment

## 2. Identity, roles, and member keys

- [ ] 2.1 Wire better-auth with GitHub and Google providers plus the admin plugin
- [ ] 2.2 Test: an unknown first-time login lands in `revoked` and reaches no pooled account until granted
- [ ] 2.3 Implement roles `admin` / `member` / `revoked` with enforcement on every management and proxy route
- [ ] 2.4 Test: a management session cannot drive a proxy route and a member key cannot administer
- [ ] 2.5 Test: the last remaining admin cannot demote themselves
- [ ] 2.6 Implement member keys — generate, hash, constant-time verify, revoke, expire
- [ ] 2.7 Implement the auth gate with per-source failed-auth backoff and distinct revoked/expired/unknown error codes
- [ ] 2.8 Test: revocation takes effect on the next request with no expiry to wait out

## 3. Enrolment

- [ ] 3.1 Implement scratch-directory capture in the client: run pi login under a temporary `PI_CODING_AGENT_DIR`, harvest the credential
- [ ] 3.2 Test: the member's real `auth.json` is byte-identical before and after a capture
- [ ] 3.3 Test: the scratch directory is removed on both the success and failure paths
- [ ] 3.4 Implement the orphan sweep at client start
- [ ] 3.5 Implement the upload endpoint with duplicate-account rejection
- [ ] 3.6 Test: enrolling an already-present account is rejected and does not overwrite the stored credential
- [ ] 3.7 Enrol one low-value account end to end and confirm it is stored encrypted

## 4. Refresher

- [ ] 4.1 Implement refresh-before-expiry with per-account serialisation, following the shape in `model-proxy/internal-auth-storage.ts`
- [ ] 4.2 Implement atomic persistence of the rotated refresh token
- [ ] 4.3 Implement the startup ownership guard so a second instance refuses to start its refresher
- [ ] 4.4 Test: two concurrent in-process refresh triggers produce exactly one refresh
- [ ] 4.5 Test: a second instance against the same database is rejected rather than refreshing in parallel
- [ ] 4.6 Test: a provider rejection moves the account to `dead`; a transient network error leaves it unchanged
- [ ] 4.7 Run `doubt-driven-review` on the refresher before it lands — a mistake here revokes real token families

## 5. Forwarding, single account

- [ ] 5.1 Implement the `anthropic-messages` endpoint: authenticate the key, decrypt the account, forward upstream
- [ ] 5.2 Test: an invalid member key is rejected before any account is decrypted
- [ ] 5.3 Implement streaming relay without buffering the response
- [ ] 5.4 Test: response chunks reach the client progressively rather than only at completion
- [ ] 5.5 Implement response and error sanitisation so no credential material can be returned to a client
- [ ] 5.6 Test: an upstream auth error echoing credential material is sanitised before relay
- [ ] 5.7 Add `openai-completions` and `openai-responses` endpoints
- [ ] 5.8 Implement per-key and per-account concurrency limits with retry indication
- [ ] 5.9 Verify end to end: a pi client configured with `baseUrl` and a member key works with no client plugin present

## 6. Pool and selection

- [ ] 6.1 Implement account visibility `private` / `shared`, defaulting to private, owner-only mutation
- [ ] 6.2 Test: another member's private account is never eligible; unsharing withdraws at the next request
- [ ] 6.3 Implement per-member per-provider primary selection with single-primary enforcement
- [ ] 6.4 Test: a primary designation is cleared when the account stops being available to that member
- [ ] 6.5 Implement pool ordering spanning own and shared accounts, provenance-blind apart from primary
- [ ] 6.6 Implement health states `ok` / `cooling` / `dead` and cooldown expiry
- [ ] 6.7 Test: an empty pool returns the earliest cooldown expiry, distinct from a no-accounts-at-all error

## 7. Rotation and its gate

- [ ] 7.1 Implement request-body buffering for replayability with a configured size bound
- [ ] 7.2 Implement 429 handling: mark cooling from `retry-after`, fall back to a bounded default when absent
- [ ] 7.3 Implement same-request re-forwarding on the next eligible account with a bounded attempt limit
- [ ] 7.4 Test: a request rate-limited on the first account succeeds on the next and the client sees no failure
- [ ] 7.5 Test: no rotation occurs once response bytes have been relayed
- [ ] 7.6 Test: a request above the buffering bound forgoes rotation rather than buffering unbounded
- [ ] 7.7 Implement the admin and member rotation settings, ANDed, both defaulting on, read at request time
- [ ] 7.8 Test: the admin switch overrides an enabled member setting, and takes effect on the next request without a session restart
- [ ] 7.9 Test: with rotation off, a cooling primary is still attempted and a dead primary returns an explicit error
- [ ] 7.10 Test: health is still recorded while rotation is off
- [ ] 7.11 Test: a client-supplied parameter cannot cause rotation while the admin switch is off
- [ ] 7.12 Exercise rotation against a genuinely rate-limited account, not only a synthetic 429

## 8. Audit and observability

- [ ] 8.1 Implement append-only audit entries for enrolment, visibility, role, key, refresh, state transition, and rotation
- [ ] 8.2 Test: a rotation entry names the rate-limited account, the serving account, and the member
- [ ] 8.3 Test: no audit entry contains credential material
- [ ] 8.4 Run `observability-instrumentation` for the refresher loop and the selection path — rotation and refresh failures must be diagnosable after the fact

## 9. Client plugin

- [ ] 9.1 Create `packages/keysync-client/` workspace and register it
- [ ] 9.2 Implement local provider configuration writing, leaving unrelated provider entries unchanged
- [ ] 9.3 Test: unrelated provider entries are untouched, and removing the plugin restores direct operation
- [ ] 9.4 Build the accounts surface from `mockups/provider-accounts.html` — pool, primary, visibility, health, remaining cooldown
- [ ] 9.5 Implement the inert-rotation-control state: when the admin has disabled rotation globally, show it inactive with the reason and who set it
- [ ] 9.6 Build the enrolment flow from `mockups/add-account.html` covering all five states
- [ ] 9.7 Build the admin surface from `mockups/pool-admin.html` — members, key revoke, pool, audit, global rotation switch
- [ ] 9.8 Surface models unroutable over OAuth per `model-proxy/oauth-compat.ts` rather than letting them fail opaquely
- [ ] 9.9 Test: no pooled provider credential exists anywhere on the client filesystem after a full session

## 10. Hardening and rollout

- [ ] 10.1 Run `security-hardening` across the auth gate, vault, enrolment upload, and forwarding paths
- [ ] 10.2 Run `performance-optimization` on the forwarding path — keysync is now on the latency path of every request
- [ ] 10.3 Run `review-code` over the full diff before commit
- [ ] 10.4 Write operator setup docs: KEK supply, backup, and the explicit warning that KEK loss is unrecoverable
- [ ] 10.5 Document the rollback path — remove the client plugin and restore a direct provider entry
- [ ] 10.6 Enrol the remaining accounts and switch members' provider entries to keysync
