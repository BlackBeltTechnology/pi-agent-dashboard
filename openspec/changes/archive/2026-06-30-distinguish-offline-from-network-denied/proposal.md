## Why

GitHub issue #99 (later screenshots) + maintainer report: accessing the dashboard remotely (browser on `brass.lan` → server on `pennyroyal.lan:4040`) produces three confusing, conflated failure states. The user cannot tell **"the server is offline"** from **"the server is up but my network is not allowed"** — they look identical in the UI.

Three concrete defects:

1. **A hardcoded `localhost` "Local" entry is shown to remote clients.** `ServerSelector.tsx` unconditionally seeds `{ host: "localhost", port: currentPort, label: "Local", isLocal: true }`. When the page is served from `pennyroyal.lan:4040` and viewed on `brass.lan`, that entry probes `http://localhost:4040/api/health` **from the browser's machine** — which has nothing there — and renders "localhost:4040 is unreachable". A meaningless self-referential entry that looks like a real outage.

2. **Guarded endpoints return an opaque 403 indistinguishable from "down".** `/api/browse` (Pin Directory) is wrapped by `createNetworkGuard`, which allows only loopback / `trustedNetworks` / authenticated requests and otherwise replies `403 { error: "Access denied" }`. A remote LAN client that is neither trusted nor authenticated gets a bare "Access denied" with no hint that the fix is "add your subnet to `trustedNetworks` or sign in". Meanwhile `/api/health` is **ungated** (returns 200 remotely), so the *server* is plainly reachable — yet the user, seeing "Access denied" + "Server offline", concludes the server is broken.

3. **No offline-vs-denied distinction anywhere in the client.** The connection-status banner and server-selector collapse every non-OK probe/WS state into "unreachable / offline". HTTP 403 (policy refusal) and a dead socket (genuine outage) are the same red state.

Maintainer ask, verbatim: *"maybe some help to allow network access can differentiate offline or network does not allowed. It helps distinguish the real offline and network not allowed."*

## What Changes

- **Stop seeding a `localhost` entry for remote origins.** `ServerSelector` SHALL seed the `localhost` "Local" row **only when the page origin is itself loopback** (`window.location.hostname` ∈ {`localhost`, `127.0.0.1`, `::1`}). When served from a remote host, the current server (the served origin) is the "Local-equivalent" entry; no phantom `localhost` probe. Eliminates the false "localhost:4040 is unreachable".

- **Make the network guard's 403 self-describing.** `createNetworkGuard` SHALL return `403 { success: false, error: "network_not_allowed", reason, hint }` where `reason` distinguishes the cause (not loopback, not in `trustedNetworks`, not authenticated) and `hint` tells the user the remedy (add subnet to `trustedNetworks` in Settings → Servers, or sign in). Machine-readable `error: "network_not_allowed"` lets the client branch on policy-denial vs transport failure. **BREAKING** for any consumer string-matching the old `"Access denied"` body (internal only; update call sites + tests).

- **Teach the client to distinguish denied from offline.** When an API call (e.g. `/api/browse`) returns HTTP 403 with `error: "network_not_allowed"`, the client SHALL render a distinct **"Network not allowed"** state (with the server's `hint`) — NOT "Server offline" / "unreachable". A transport failure or non-403 unreachable SHALL keep rendering the existing offline/unreachable state. This applies to the Pin Directory dialog (the literal "Access denied" surface) and the connection-status banner.

- **Surface the remedy.** The "Network not allowed" state SHALL link to Settings → Servers (where `trustedNetworks` is configured) and/or the auth flow, turning a dead-end into an actionable step.

No new capabilities. Health endpoint stays ungated (reachability signal is intentional and useful here).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `server-selector`: the `localhost` "Local" seed is conditional on a loopback page origin; remote-served deployments do not show a phantom `localhost` entry. Unreachable rendering distinguishes a 403 policy-denial from a transport-unreachable probe.
- `trusted-networks`: the network guard's 403 body becomes self-describing (`error: "network_not_allowed"`, `reason`, `hint`) instead of `{ error: "Access denied" }`, so clients can branch on policy denial vs outage.
- `connection-status-banner`: a distinct "Network not allowed" presentation (with remedy hint + link to Settings → Servers) when the failure is a guard 403, separate from the existing "Disconnected / Retrying" offline banner.
- `filesystem-browser`: the Pin Directory / `/api/browse` failure surface renders the "Network not allowed" hint on a guard 403 rather than a bare "Access denied".

## Impact

Affected code:
- `packages/client/src/components/ServerSelector.tsx` — conditional `localhost` seed based on `window.location.hostname`; 403-vs-transport distinction in probe handling.
- `packages/server/src/localhost-guard.ts` — `createNetworkGuard` returns the structured 403 body (`error`, `reason`, `hint`).
- `packages/client/src/components/<PinDirectory/browse dialog>` — branch on `error === "network_not_allowed"` to show the remedy hint + Settings link.
- `packages/client/src/components/<connection-status banner>` — distinct "Network not allowed" variant.
- Tests: `packages/server/src/__tests__/localhost-guard.test.ts` (new 403 shape), `packages/client/src/__tests__/server-selector.test.ts` (no localhost seed when remote origin), browse-dialog + banner tests.

## Open Questions
- Does `request.isAuthenticated` actually get set for `/api/browse` calls when the user has "Credentials configured"? Issue #99 shows credentials configured yet still denied — confirm whether auth applies to API calls or only the page shell (may reveal a separate auth-plumbing gap). Resolve in design.md before implementing the client branch.
- Should the client offer an inline "Trust this network" action (writes `trustedNetworks`) from the denial surface, or only deep-link to Settings? Scope decision in design.md.
- Out of scope: the intermittent remote WebSocket "Server offline" drop (image 3/4) needs a runtime repro before it can be specced; tracked as a follow-up, not addressed here.
