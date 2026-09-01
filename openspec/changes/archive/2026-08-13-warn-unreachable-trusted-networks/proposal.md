## Why

Trusted networks and the listen interface are coupled in reality but only half-coupled in the UI. `hasGuardConfig()` lets the **Server** page read Security-page state to warn "you are exposed" when binding `0.0.0.0` with no guard configured. The return edge is missing: a user who adds a trusted network while the server is bound to `127.0.0.1` (the default) gets **no signal at all** — the config is saved, looks correct, and the network still cannot reach the dashboard.

The one affordance that would normally rescue them, `BlockEventTrustBanner`, is structurally guaranteed to be empty in exactly this state: `blockEvents.record()` runs inside the Fastify request handler (`localhost-guard.ts:122`), so a connection refused at the TCP layer by a loopback bind never produces a block event. The user stares at a Trusted Networks section that is silently, permanently blank.

A **second silent failure of the same shape** lives one button away. `+ Add Local Network` derives each offer as `networkAddress(addr, netmask)/netmaskToCidrBits(netmask)` (`system-routes.ts:718-738`) — pure netmask arithmetic. A point-to-point interface reports a `/32` netmask, so a Tailscale interface at `100.97.246.31/255.255.255.255` is offered as `100.97.246.31/32`: a range matching exactly one address, **this host**, which is already loopback-exempt. The user clicks the entry the UI offered, saves, and trusts nobody new. The same applies to WireGuard and any `utun`/`wg`/`ppp` device. Meanwhile `suggestTrustEntries` (`gateway-config-ops.ts:95-111`) — used by the block-event banner — *already* knows `100.64.0.0/10` is the tailnet CGNAT range. Two paths to the same decision give contradictory advice (Nielsen H4).

Both defects compound in one flow: the user picks a useless entry, then the reachability advisory fires naming that useless entry.

## What Changes

- Add a **reachability advisory** to the Trusted Networks section (Security page): shown when the resolved bind host cannot serve any configured trusted entry. Amber, same visual slot and idiom as `BlockEventTrustBanner`.
- The advisory is **general**, not loopback-only: it also fires for a specific-NIC bind (`bindHost = 10.0.0.5`) against a trusted range that NIC cannot serve (`192.168.1.0/24`). Loopback trusted entries (`127.0.0.1`, `127.0.0.0/8`) never trigger it.
- Add a pure client-side CIDR/wildcard **containment helper** to `gateway-config-ops.ts` (no equivalent exists client-side today; `isBypassedHost` is server-only).
- Provide **both** remediation affordances in the advisory: an inline button that sets `bindHost = "0.0.0.0"` in the working draft, and a link that navigates to `/settings/server` and focuses the listen-interface picker.
- The advisory states that changing the listen interface is **restart-required**, since `bindHost` is restart-required while `auth.bypassHosts` is live-reloaded.
- Add the **headless half**: a startup log line and an additive field on the **guarded** config surface when trusted networks are configured but the pending bind host cannot serve them (never on the unguarded `/api/health`, which would disclose private network topology) — covering `config.json`/CLI users who never open Settings.
- Make `+ Add Local Network` use the **same suggestion engine as the block-event banner**. A normal broadcast interface keeps its netmask-derived CIDR as the narrow (green) offer. A point-to-point `/32` interface has no meaningful narrow offer — its own address is the host itself — so it offers the containing range from `suggestTrustEntries` as a wide (amber) option, carrying that idiom's existing "grants unauthenticated access to the whole {range} range" warning.
- **Deduplicate** offers **in the dropdown** — keyed on the suggestion value, not the CIDR — and give each interface a **meaningful label** (`utun4` → Tailscale) instead of the raw device name. The endpoint keeps returning every address, because the Server page's listen-interface picker consumes the same payload and needs each bind address to stay selectable.
- Evaluate the predicate against the **resolved** bind host (`--host` → `PI_DASHBOARD_HOST` → `config.bindHost`), published by the server, rather than `config.bindHost` alone — which understates the true bind whenever a flag or environment variable set it.
- Carve out a **spec exception** for cross-page remediation: `settings-panel` currently forbids rendering a field on a page other than the one its top-level key maps to, because the dirty-page chip would name the wrong page. The inline button mutates `bindHost` (a Server-page key) from the Security page, so the exception must be explicit rather than a silent violation.

Not in scope: any change to guard behaviour. The advisory is advisory only — no request is allowed or denied differently. No modal or push-based approval prompt for unknown hosts (evaluated and rejected: it inverts the operator-initiated ordering that makes device pairing safe, and it cannot fire under a loopback bind anyway, so it does not address this problem).

## Capabilities

### New Capabilities
<!-- none — this extends two existing capabilities -->

### Modified Capabilities
- `server-bind-host`: new requirement for a bind-reachability advisory (the mirror of the existing all-interfaces exposure warning), a generalized reachability predicate covering specific-NIC binds, the `resolvedBindHost`/`pendingBindHost` pair the predicate consumes, and the headless startup-log + guarded-config-surface reporting.
- `settings-panel`: the Trusted Networks section gains the advisory; the Add Local Network dropdown gains risk-tiered suggestions, dedupe, and labels; an explicit exception is added to the page-attribution rule permitting an advisory remediation control to mutate another page's key, with defined dirty-chip behaviour.
- `trusted-networks`: `GET /api/network-interfaces` gains per-entry `label`, a `pointToPoint` flag, and suggestion entries, and deduplicates identical CIDRs.

## Impact

**Client**
- `packages/client/src/components/settings/SettingsPanel.tsx` — `TrustedNetworksSection` gains the advisory; `computeConfigPartial`/`CONFIG_FIELD_PAGE` behaviour for `bindHost` is unchanged but now reachable from the Security page.
- `packages/client/src/lib/gateway/gateway-config-ops.ts` — new pure containment helper + reachability predicate (exported for tests, mirroring `suggestTrustEntries`).

**Server**
- `packages/server/src/server.ts` (or the bind/startup path) — startup log line.
- `packages/server/src/routes/system-routes.ts` — additive **guarded** config-surface fields (`resolvedBindHost`, `pendingBindHost`, the unreachable-entry condition), failure-isolated like the other telemetry reads and stripped on write; `/api/network-interfaces` gains `label`, `pointToPoint`, and `suggestions`, and continues to return one entry per address.

**Unaffected**
- `docker/compose.yml:38` defaults `PI_DASHBOARD_HOST` to `0.0.0.0`, so with the shipped default the predicate is false in containers — no spurious advisory in the docker harness or E2E. This holds only because the predicate reads the resolved host; evaluating `config.bindHost` (never seeded by `entrypoint.sh`) would have warned in every container.
- The network guard, `BlockEventBuffer`, and the pairing flow are untouched.

**Tests**
- Unit: containment helper + predicate truth table (loopback bind, specific-NIC bind, all-interfaces bind, loopback-only trusted entries, empty lists).
- Client: advisory visibility and both remediation affordances.
- Server: guarded-surface field presence and value; a negative test asserting the values do NOT appear in the unguarded `/api/health`; stripped on write.

**Rollback**: purely additive UI/telemetry; reverting the commit restores current behaviour with no config migration and no persisted state to unwind.

## Discipline Skills

- `security-hardening` — the change is guidance about network exposure; the advisory must not nudge a user toward a wider bind than their trusted range requires, and must not weaken the existing exposure warning in the opposite direction.
- `observability-instrumentation` — a new startup log line and a new guarded config-surface field need to follow the additive, failure-isolated pattern used by the existing telemetry reads, without repeating the first draft's error of putting operator network topology on the unguarded `/api/health`.
- `doubt-driven-review` — the `settings-panel` page-attribution carve-out is an intentional exception to a rule with a stated rationale; it should be stress-tested before it is written into the spec.
- `review-code` — non-trivial cross-package change; review before commit once tests pass.
