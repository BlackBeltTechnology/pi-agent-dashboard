## Why

Managed services ship REST + CLI only (`add-service-registry-core`, "Not in this change": `add-services-settings-ui`). An operator cannot see which services exist, why one is `unavailable`/`blocked`, which runtime is down, or who holds a lease without a terminal. Diagnosis needs output the service layer never keeps: native/attached children run with `stdio: "ignore"` (`packages/server/src/services/native-driver.ts:145`, `attached-driver.ts:97`), so there are no logs to look at. This change delivers roadmap item 2 of `spike-managed-services`.

## What Changes

- **New top-level Settings nav group "Services"** between Network and Add-ons, with two pages: `services`, labelled "All services" (list + per-service detail at `/settings/services/<id>`) and `runtimes` (container runtime + hypervisor capability matrix from `GET /api/services/runtimes`).
- **Service list**: one row per service — state pill (closed `ServiceState` set; shape + text, not colour alone), grouped Needs attention / Running / Stopped, `reason` + `hint` in plain language, driver, endpoints, exposure, leases count, pinned, `updateAvailable`, `restartRequired`. Banners for `definitionsCorrupt` / `secretsCorrupt` naming the backup path.
- **Service detail**: actions Start / Stop / Force stop (only where the server refuses a plain stop: `adoption-uncertain`, or an instance not started by the dashboard) / Retry / Pin / Unpin / Prefetch, each shown only when legal for the current state; lease-holder list; write-only secret inputs (configured / not configured, never a value); update diff + apply; remove with "also delete data volumes" option; logs viewer; reset data.
- **Add service**: from a discovered offer (dry-run review card → explicit confirm, optional prefetch as a separate checkbox, never implied) or from a pasted user JSON definition (validated by the same dry-run, errors listed by key).
- **New server routes** (all under the existing `/api/services` guard model):
  - `GET /api/services/:id/logs?tail=N` — last N lines (1–2000). OCI → runtime `logs --timestamps --tail` (stdout+stderr merged); native/attached → `services-run/<id>/output.log`, also after a failed start (`stale: true`). Requires **operate** authority although it is a GET, and redacts every configured secret value (longest first) on the raw output; an unreadable, too-short or since-changed secret withholds the output and is named.
  - `POST /api/services/:id/reset-data` — removes the service's declared named volumes; refused unless stopped (or safely `unavailable`), and refused when a volume is declared by another service or used by a foreign container.
  - `POST /api/services/prune` — removes dashboard-owned leftovers with no definition: containers labelled `pi.owner=<instanceId>` whose `pi.service` id is undefined, and orphan `services-run/<id>/` dirs (valid service-id names only). Dry run first; the confirm removes only the previewed ids that are still leftovers and reports skipped ones.
  - `GET /api/services[/:id]` gains `leaseHolders: [{ holder?, expiresAt }]` (no `leaseId`); the list gains `canOperate` so the UI knows when it is read-only.
- **Native/attached output capture**: dashboard-started children append stdout+stderr to `services-run/<id>/output.log` (0600) instead of `stdio: "ignore"`; cleared in place at each start and capped near 1 MiB by in-place truncation (5 s check). Every start writes `start.json` (time, keyed digest of the delivered secret values); a saved secret asks for a restart, also across server restarts.
- **WebSocket push**: new payload-free `services_changed` server→browser ping after every state transition, pin, lease count change, add/update/remove and secret-configured change, coalesced to ≤1 per 500 ms and never shed. The page refetches the non-probing `GET /api/services` on each ping and on reconnect, so every byte of service data still passes the HTTP route guard; the frame carries no ids, endpoints or states.
- **Remove with purge**: the same shared/in-use volume guards as reset-data.
- **OCI stop fix**: stop without a recorded instance filters by owner as well as service label, as the existing spec already requires.
- **Settings registry**: `services` and `runtimes` join `VALID_SETTINGS_TABS` (global only, not folder settings); the second URL segment is interpreted for `services` (service id) as it is for `plugins`; Services actions are exempt from the Save Bar.
- Mockup: mockups/services-settings (in this change) — live mockup + fixture mock server (`node mock-server.mjs`); decisions and gate results in `mockups/ui-plan.md`.

## Capabilities

### New Capabilities
- `services-settings-ui`: the Settings → Services nav group, list/detail/add/runtimes pages, action gating per state, secret entry, logs viewer, destructive-action confirmations, live updates.

### Modified Capabilities
- `managed-services`: logs, reset-data, prune routes; lease holders and `canOperate` in status; output capture for native/attached; `services_changed` ping; the read-route authority rule names the logs exception.
- `service-secrets`: the "values never leave the delivery channel" rule gains one stated exception — redacted output from the operate-only logs route.
- `settings-panel`: nav group order gains Services; page-id registry gains `services`, `runtimes` (not folder-settings ids); second segment interpreted for `services`; Save Bar exemption names the Services pages.

## Discipline Skills

- `security-hardening` — logs are a new read path that can echo secrets (child env carries values by design); prune/reset-data are destructive; WS ping reaches every browser socket (hence payload-free).
- `doubt-driven-review` — reset-data and prune irreversibly delete user data (volumes, containers).
- `observability-instrumentation` — new routes and output capture; log lines for prune/reset-data outcomes.
- `review-code` — before commit.

## Impact

- Server: `packages/server/src/services/{routes,service-manager,native-driver,attached-driver,oci-driver,leases,paths}.ts`, `server.ts` (broadcast wiring), `pairing/browser-gateway.ts` (frame class); route-tier table `packages/shared/src/route-tiers.ts` (operate rows for logs, reset-data, prune); `command-runner.ts` (`truncated` flag), `secrets-resolver.ts` (`kind: unset | unreadable`), `state-machine.ts` (change hook). The MCP denylist already covers `/api/services/*` (no change).
- Shared: `packages/shared/src/browser-protocol.ts` (`services_changed`), `packages/shared/src/services/schema.ts` (status/log/prune types).
- Client: new `packages/client/src/components/settings/services/*`; `SettingsPanel.tsx` nav groups, `VALID_PAGES`, second-segment parse (`activeServiceId`); the folder-settings surface keeps rejecting `services`/`runtimes`; i18n strings.
- Shared registry: `packages/shared/src/dashboard-plugin/slot-types.ts` (`SettingsTab`, `VALID_SETTINGS_TABS`).
- Docs: `docs/managed-services.md` (routes, logs, prune, UI).
- Interaction: `absorb-service-secrets-into-vault` (open) moves the secret store; the UI writes through `PUT /api/services/:id/secrets/:name` only, so it is backend-agnostic.
- Compatibility: additive routes and message type; old clients ignore `services_changed`. Rollback = revert; `output.log*` files are inert and removed with the run dir by `service remove`. Behaviour changes: `remove --purge-data` now keeps (and reports) volumes another service declares or a foreign container uses; OCI stop no longer touches foreign-owner containers.
