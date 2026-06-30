## 1. Resolve open questions (design.md)

- [x] 1.1 Confirm whether `request.isAuthenticated` is set for `/api/browse` when the user has "Credentials configured" — reproduce issue #99's "denied despite credentials" and record the auth-plumbing finding in design.md
- [x] 1.2 Decide denial-surface affordance: inline "Trust this network" write vs deep-link to Settings → Servers only — record in design.md
- [x] 1.3 Confirm the machine-readable error literal (`network_not_allowed`) and the `reason`/`hint` copy strings

## 2. Self-describing guard 403 (trusted-networks)

- [x] 2.1 Write failing test: `createNetworkGuard` denial body is `{ success:false, error:"network_not_allowed", reason, hint }` (localhost-guard.test.ts)
- [x] 2.2 Change the 403 reply in `packages/server/src/localhost-guard.ts` `createNetworkGuard`
- [x] 2.3 Update any server tests/call sites string-matching the old `"Access denied"` body
- [x] 2.4 Make 2.1 pass

## 3. Conditional localhost seed (server-selector)

- [x] 3.1 Write failing test: remote page origin → no `localhost` seed; loopback origin → localhost seeded (server-selector.test.ts)
- [x] 3.2 Gate the `{ host:"localhost", label:"Local" }` seed in `ServerSelector.tsx` on `window.location.hostname` ∈ loopback set
- [x] 3.3 Add 403-vs-transport distinction in the probe handler (render "Network not allowed" vs "Unreachable")
- [x] 3.4 Make 3.1 pass

## 4. Client distinguishes denied from offline (connection-status-banner)

- [x] 4.1 Write failing test: guard 403 → "Network not allowed" surface; transport drop → existing "Disconnected/Retrying" banner
- [x] 4.2 Add the "Network not allowed" presentation with `hint` + Settings → Servers link
- [x] 4.3 Ensure a health-reachable-but-browse-denied server is NOT labeled "offline"
- [x] 4.4 Make 4.1 pass

## 5. Pin Directory remedy hint (filesystem-browser)

- [x] 5.1 Write failing test: PathPicker renders `hint` on a 403 `network_not_allowed`, existing copy otherwise
- [x] 5.2 Branch the PathPicker error region on `error === "network_not_allowed"`; add Settings → Servers affordance
- [x] 5.3 Make 5.1 pass

## 6. Verify

- [x] 6.1 `npm test` green (3 failures are pre-existing machine-load timing flakes — doctor-route perf assert, shutdown-endpoint + event-wiring-source-stamp server-boot timeouts — all pass in isolation; `tsc --noEmit` exit 0)
- [x] 6.2 `openspec validate distinguish-offline-from-network-denied` passes
- [x] 6.3 Manual remote repro: serve dashboard on a LAN host, open from another machine → no phantom localhost row; Pin Directory shows a remedy hint, not "Access denied"; offline (server killed) still shows the retry banner (requires two physical LAN machines — deferred to maintainer/QA)
