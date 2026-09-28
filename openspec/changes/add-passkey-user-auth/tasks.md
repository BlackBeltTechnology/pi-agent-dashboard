## 1. Spike gate — choose the backend (design D1). No production code.

- [ ] 1.1 Spike A (managed Pocket ID), on a throwaway branch: download the platform binary, run it on loopback with `STATIC_API_KEY`, and expose it next to (a) a Tailscale primary on a 2nd port and (b) a second **reserved** zrok share. Register the dashboard as a generic `oidc` provider. Run the flow end to end: signup-token QR → phone passkey → "sign in with another device" → dashboard session. Record what works per origin and the LOC estimate for the supervisor, proxy, and API client
- [ ] 1.2 Spike B (native), on a throwaway branch: implement a minimal `@simplewebauthn/server` register/assert on the primary origin, plus a phone-approval request reusing the pairing pending pattern. Run the same flow against the same two primaries. Record the LOC and the list of security-sensitive routes
- [ ] 1.3 Run `doubt-driven-review` on the two spike reports against the D1 exit criteria. Write **D1-result** into `design.md` (chosen option + evidence)
- [ ] 1.4 Run `openspec-update-change`: delete the losing option's tasks (§4A or §4B), then fold in any spec or design corrections the spike revealed. Run `scenario-design` → `test-plan.md` and replace the placeholder verification references below with test ids

## 2. Session tier (both options)

- [ ] 2.1 Add the optional `tier` to the JWT payload type and to issuance in `packages/server/src/auth/auth.ts` / `auth-plugin.ts`. Set `request.principalTier = claims.tier ?? "operate"` on session validation; verify via 2.4
- [ ] 2.2 Add the `auth.groupTiers` config type (shared) and the groups-claim mapping in the OIDC callback: highest tier wins, and login is refused when configured with no match; verify via 2.5
- [ ] 2.3 Confirm `route-tier-gate.ts` needs no change beyond receiving `principalTier` for sessions. Add `ROUTE_TIERS` entries for every new route in `packages/shared/src/route-tiers.ts`; verify via the route-tier contract test
- [ ] 2.4 Test the session tier (spec `oauth-authentication` › Session tier claim): an observe JWT is refused on an operate route; a legacy JWT without a tier is allowed; loopback is unaffected
- [ ] 2.5 Test the group map (spec › OIDC groups map to a tier): highest wins, no match is refused, unconfigured keeps legacy behaviour

## 3. RP ID, stable-origin gate, primary-switch impact (both options)

- [ ] 3.1 Add `resolveRpContext()` returning `{rpOrigin, rpId, stable, reason?}` derived from the existing redirect-base resolution (design D2). Add no new resolution chain; verify via 3.4
- [ ] 3.2 Add `GET /api/users/credentials/impact?rpId=` and wire it into the existing primary-switch confirmation (and the `auth.redirectBaseUrl` edit) to show the orphan count; verify via 3.5
- [ ] 3.3 Show disabled-with-reason states on the login page and in Settings ▸ Users when `stable` is false
- [ ] 3.4 Test RP ID resolution and the stable predicate: override wins; Tailscale primary; reserved vs ephemeral zrok; IP and localhost count as unstable
- [ ] 3.5 Test orphan handling: a credential under another RP ID is excluded and listed; switching back revives it; the impact counts are correct

## 4A. Option A — managed Pocket ID (delete if D1 picks B)

- [ ] 4A.1 Add a `pocket-id` tool-registry entry: per-platform GitHub release download with `checksums.txt` verification into the managed install dir; install guide modelled on `zrok-install-guide`
- [ ] 4A.2 Add a supervisor: spawn on loopback, PID file + orphan scavenge (pattern: `zrok-process-tunnel`), `STATIC_API_KEY` generated once and stored `0600`, telemetry and UI-config disabled
- [ ] 4A.3 Expose the origin per primary kind (design D6): 2nd port / host-routed `id.` / reserved share. Derive `APP_URL` from `resolveRpContext()`
- [ ] 4A.4 Add an admin-API client: users, `dashboard-*` groups ↔ tier, signup tokens (QR), revoke. Auto-register the dashboard OIDC client and `groupTiers`
- [ ] 4A.5 Add Settings ▸ Users backed by the admin API

## 4B. Option B — native passkeys (delete if D1 picks A)

- [ ] 4B.1 Add the `@simplewebauthn/server` dependency (pnpm) and a user registry `~/.pi/dashboard/users.json` (`0600`, locked writes via `locked-json-file.ts`) storing users, tier, status, and credentials with `rpId`
- [ ] 4B.2 Add routes: invite mint/list/revoke (operator), invite registration options/verify, passkey login options/verify. Challenges are single-use with a TTL, and user verification is required
- [ ] 4B.3 Add sign-in-with-phone: start / poll / phone view / approve (assertion) / deny, reusing pairing metadata bounding and the rate limits (design D5)
- [ ] 4B.4 Add a per-request directory lookup so revoke and re-tier apply at the next request (design D4). First-user bootstrap is genuine-local only
- [ ] 4B.5 Add a client: Settings ▸ Users (list, tier, revoke, orphaned, invite QR via the shared `pairing-qr` encoder), login page passkey + phone QR, and the phone approval page

## 5. Observability, docs, verification

- [ ] 5.1 Add `[passkey]` event logs per design D7; test the line shape and that no secrets appear (spec › Passkey events are logged without secrets)
- [ ] 5.2 Run `security-hardening` over the new routes, tokens, and approver-facing metadata; fix any findings
- [ ] 5.3 Delegate docs to DocScribe: a `docs/` page for user management and passkeys (RP ID = primary domain, stable-origin rule, recovery), plus FAQ entries
- [ ] 5.4 Add Playwright E2E with a virtual WebAuthn authenticator: invite → enroll → passkey login; a phone-approval flow across two browser contexts
- [ ] 5.5 Run `review-code` on the full diff before commit
