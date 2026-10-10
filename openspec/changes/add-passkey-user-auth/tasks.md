## 1. Spike gate — choose the backend (design D1). No production code.

- [x] 1.1 (waived by operator — D1 defaults to B, see design D1-result) Spike A (managed Pocket ID), on a throwaway branch: download the platform binary, run it on loopback with `STATIC_API_KEY`, and expose it next to (a) a Tailscale primary on a 2nd port and (b) a second **reserved** zrok share. Register the dashboard as a generic `oidc` provider. Run the flow end to end: signup-token QR → phone passkey → "sign in with another device" → dashboard session. Record what works per origin and the LOC estimate for the supervisor, proxy, and API client
- [x] 1.2 (waived by operator — D1 defaults to B, see design D1-result) Spike B (native), on a throwaway branch: implement a minimal `@simplewebauthn/server` register/assert on the primary origin, plus a phone-approval request reusing the pairing pending pattern. Run the same flow against the same two primaries. Record the LOC and the list of security-sensitive routes
- [x] 1.3 (D1-result recorded: B) Run `doubt-driven-review` on the two spike reports against the D1 exit criteria. Write **D1-result** into `design.md` (chosen option + evidence)
- [x] 1.4 (§4A deleted; test-plan.md not authored — legacy defer applies) Run `openspec-update-change`: delete the losing option's tasks (§4A or §4B), then fold in any spec or design corrections the spike revealed. Run `scenario-design` → `test-plan.md` and replace the placeholder verification references below with test ids

## 2. Session tier (both options)

- [x] 2.1 Add the optional `tier` to the JWT payload type and to issuance in `packages/server/src/auth/auth.ts` / `auth-plugin.ts`. Set `request.principalTier = claims.tier ?? "operate"` on session validation; verify via 2.4
- [x] 2.2 Add the `auth.groupTiers` config type (shared) and the groups-claim mapping in the OIDC callback: highest tier wins, and login is refused when configured with no match; verify via 2.5
- [x] 2.3 (gate changed: it now also applies to `authVia === "session"`) Confirm `route-tier-gate.ts` needs no change beyond receiving `principalTier` for sessions. Add `ROUTE_TIERS` entries for every new route in `packages/shared/src/route-tiers.ts`; verify via the route-tier contract test
- [x] 2.4 Test the session tier (spec `oauth-authentication` › Session tier claim): an observe JWT is refused on an operate route; a legacy JWT without a tier is allowed; loopback is unaffected
- [x] 2.5 Test the group map (spec › OIDC groups map to a tier): highest wins, no match is refused, unconfigured keeps legacy behaviour

## 3. RP ID, stable-origin gate, primary-switch impact (both options)

- [x] 3.1 Add `resolveRpContext()` returning `{rpOrigin, rpId, stable, reason?}` derived from the existing redirect-base resolution (design D2). Add no new resolution chain; verify via 3.4
- [x] 3.2 Add `GET /api/users/credentials/impact?rpId=` and wire it into the existing primary-switch confirmation (and the `auth.redirectBaseUrl` edit) to show the orphan count; verify via 3.5
- [x] 3.3 Show disabled-with-reason states on the login page and in Settings ▸ Users when `stable` is false
- [x] 3.4 Test RP ID resolution and the stable predicate: override wins; Tailscale primary; reserved vs ephemeral zrok; IP and localhost count as unstable
- [x] 3.5 Test orphan handling: a credential under another RP ID is excluded and listed; switching back revives it; the impact counts are correct

## 4B. Option B — native passkeys (D1-result)

- [x] 4B.1 Add the `@simplewebauthn/server` dependency (pnpm) and a user registry `~/.pi/dashboard/users.json` (`0600`, locked writes via `locked-json-file.ts`) storing users, tier, status, and credentials with `rpId`
- [x] 4B.2 Add routes: invite mint/list/revoke (operator), invite registration options/verify, passkey login options/verify. Challenges are single-use with a TTL, and user verification is required
- [x] 4B.3 Add sign-in-with-phone: start / poll / phone view / approve (assertion) / deny, reusing pairing metadata bounding and the rate limits (design D5)
- [x] 4B.4 Add a per-request directory lookup so revoke and re-tier apply at the next request (design D4). First-user bootstrap is genuine-local only
- [x] 4B.5 Add a client: Settings ▸ Users (list, tier, revoke, orphaned, invite QR via the shared `pairing-qr` encoder), login page passkey + phone QR, and the phone approval page

## 5. Observability, docs, verification

- [x] 5.1 Add `[passkey]` event logs per design D7; test the line shape and that no secrets appear (spec › Passkey events are logged without secrets)
- [x] 5.2 (findings fixed: login-CSRF via Origin check on `/auth/passkey/*` POSTs, reflected XSS in login `?error=` (6.3), bounded fail-key map; accepted: unauthenticated phone-start / options flooding is DoS-only and bounded) Run `security-hardening` over the new routes, tokens, and approver-facing metadata; fix any findings
- [x] 5.3 Delegate docs to DocScribe: a `docs/` page for user management and passkeys (RP ID = primary domain, stable-origin rule, recovery), plus FAQ entries
- [ ] 5.4 (test-plan: manual-only — operator decision: harness serves http://localhost, which the stable-origin gate and Chrome WebAuthn both refuse; L2 coverage in `auth/passkey/__tests__/passkey-http.test.ts` with a software authenticator. Manual phone check on a Tailscale / reserved-zrok primary after merge) Add Playwright E2E with a virtual WebAuthn authenticator: invite → enroll → passkey login; a phone-approval flow across two browser contexts
- [ ] 5.5 Run `review-code` on the full diff before commit

## 6. Additions found during implementation (ship-it)

- [x] 6.1 Browser-WS tier gate: `shared/ws-message-tiers.ts` (every browser→server type → tier; unlisted ⇒ operate; coverage-tested against `ws-message-scope`), `pairing/ws-tier-gate.ts` (`decideWsTier`), session tier on cookie-admitted sockets, terminal ⇒ operate, live ⇒ control, revoked passkey socket closed (spec › Session tier applies to the browser WebSocket)
- [x] 6.2 Pin one `@peculiar/asn1-schema` copy (pnpm override): two copies broke every ES256 assertion ("Cannot get schema for 'ECDSASigValue'")
- [x] 6.3 Escape the login page `?error=` (pre-existing reflected XSS; passkeys make the picker render more often)

