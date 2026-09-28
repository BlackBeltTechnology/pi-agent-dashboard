## Context

See `proposal.md` — Why. This design settles the mechanics that three adversarial review cycles kept re-opening, all of which reduce to one question: **which credential does a given row own, and what counts as "configured" for it?**

Constraints that shape every decision below:

- `GET /api/provider-auth/status` returns a **bare array**, and `provider-auth-ui` pins that shape (a non-array body is an error state). No response-level metadata can be added to it without changing that contract.
- OAuth rows are built from the **local handler registry**; api-key rows come **only** from the bridge-pushed catalogue (`getLatestCatalogue()`), which is `null` until a pi session pushes one. Two different availability profiles in one response.
- `_buildAuthStatus` emits a second row `<id>-api` when an OAuth handler exists for a catalogue id. Both rows resolve to the **same** `auth.json` key via `resolveAuthJsonKey`, and `writeCredential` blind-overwrites (`provider-auth-storage.ts:251`).
- `PUT /api/providers` is a whole-map replace; `providers.json` has no lockfile (unlike `auth.json`, which is revision-checked).
- `packages/shared/src/types.ts` declares `ProviderInfo.source` with four members; pi-ai's actual union has six.

## Goals / Non-Goals

**Goals**

- One unambiguous, kind-aware definition of `configured` that survives both failure directions (keyless twin shown / working env-var key hidden).
- Close the cross-type credential clobber at the **write path**, so it is an invariant rather than a UI convention.
- Give the Add dialog and the row a correct single-provider write without a client-side read-modify-write.
- Never render "nothing configured" while credentials exist.

**Non-Goals**

- Changing what `authenticated` means, or rewiring `useProvidersReady` onto `configured`. Its under-count of env-var providers is pre-existing; widening it changes landing-page gating and belongs to its own change.
- Reconciling `provider-auth-ui`'s "OAuth popup login flow" requirement (popup + `postMessage` + a `POST /api/provider-auth/exchange` route that does not exist) with the polling implementation that actually ships. Pre-existing spec drift; noted, not fixed here.
- Adding a lockfile or revision check to `providers.json`.
- Merging the API-Proxy section, which stays on the page untouched.

## Decisions

### D1 — `configured` is derived per row kind, in the server, from evidence the row itself owns

The single most load-bearing rule in the change. `_buildAuthStatus` projects `configured` + `source` with a different predicate per row kind:

| Row kind | Emitted when | `configured` | `source` |
|---|---|---|---|
| OAuth (`auth_code` / `device_code`) | always, from the handler registry | `auth.json[id]` holds an **oauth** credential | `"stored"` when configured, else omitted |
| **Any** api-key row (twin or not) | catalogue entry, `custom` skipped | `hasStoredKey \|\| ambient \|\| (entry.configured && entry.source != null && entry.source !== "stored")` | `entry.source` when configured, else omitted |
| Custom endpoint | `/api/providers` (client-side merge) | `apiKey` non-empty AND not an unresolved `$ENV` reference | `"stored"` |

**One rule for every api-key row, not a twin special case.** The exclusion of `source: "stored"` applies to twin and non-twin alike, because `entry.configured` is `true` with `source: "stored"` for **any** stored credential — including an OAuth credential on a catalogue id that has no dashboard handler. Without the exclusion that id emits a phantom `api_key` row, `configured: true`, no `maskedKey`, whose Remove deletes the OAuth credential. `hasStoredKey` already covers every stored *api-key* credential, so excluding `stored` evidence loses nothing and closes both the twin and the non-twin hole with one term.

`entry.source == null` must be treated as **not** qualifying: the bridge's fallback branch sets `configured = true` without a `source`, and treating `undefined !== "stored"` as evidence reopens the clobber against an older pi.

*Known limitation, accepted and documented:* pi-ai's `getProviderAuthStatus` short-circuits on `storedProviders` **before** consulting env vars, so a provider holding a stored OAuth credential *and* an env API key reports `source: "stored"` and the env key is not independently visible. That key is also not the credential pi would use, so the row correctly reflects the active credential; it is a reporting limitation, not a hidden active credential.

*Alternative rejected:* deriving `configured` client-side from `maskedKey`/`ambient`. It cannot see `entry.source` at all — the env-var case is invisible to the client, which is how the original draft got it wrong.

**Badge mapping is not "any non-stored source".** Only `ambient` or `source === "environment"` earns the Environment badge (and only those carry a meaningful `envVar`). `runtime`, `fallback`, `models_json_key`, `models_json_command` are neither env vars nor necessarily un-removable — they render as ordinary API-key rows. Mapping all non-`stored` sources to "Environment" would mislabel them and strand a removable credential behind a badge with no Remove.

*Consequence to spec:* `packages/shared/src/types.ts` widens `ProviderInfo.source` to the pi-ai six-member union, and `provider-auth-bridge`'s "env var set but no auth.json entry" scenario is corrected to `configured: true`. `packages/server/src/__tests__/build-auth-status.test.ts` asserts whole rows with `toEqual`, so it breaks on the added fields — it joins the rewrite list.

### D2 — The clobber is closed in `writeCredential`, both directions

`writeCredential(provider, credential)` refuses to replace an existing credential of a **different `type`** under the same key. The refusal **throws** a typed error — it cannot be a return value, because `writeCredential` is `void` and all three call sites ignore returns, which would make the refusal silent. This covers both directions:

- api-key write over a stored OAuth credential (`anthropic-api` → `anthropic`) — surfaced as **409** from `PUT /api/provider-auth/api-key`
- OAuth sign-in completing over a stored api_key — surfaced through the **callback server's error page** (auth-code) or `flow.status = "error"` read by `GET /device-status/:flowId` (device-code). These are not JSON routes, so "409" applies to the api-key path only; each surface carries the same actionable message.
- `InternalAuthStorage.refreshOAuth` is the third caller. Same-type refreshes are unaffected; a refresh racing a credential-type switch now throws rather than clobbering.

The picker suppresses **both** directions — the twin while the OAuth sibling is connected, and the OAuth entry while the twin holds a key — each with the remove-first path stated inline, so the guard is not the user's first encounter with the conflict.

The UI rules sit **on top of** the guard, not instead of it. A UI-only rule is not an invariant: `PUT /api/provider-auth/api-key` with `provider: "anthropic-api"` is reachable by any API client.

*Consequence to spec:* `provider-auth-server`'s "API key CRUD" requirement says the PUT writes "merging with existing entries" — that requirement gains the cross-type refusal and joins the modified list.

*Alternative rejected:* silently namespacing the twin to its own `auth.json` key (e.g. `anthropic-api`). That changes what pi itself reads at request time and would strand existing keys; out of scope for a dashboard change.

*Explicit override path:* replacing a credential of a different type remains possible by removing the existing one first — the refusal is a guard against accident, not a policy.

### D3 — `PATCH` / `DELETE /api/providers/:name`

`PATCH` **upserts** — create-if-absent is required, or the Add dialog cannot add a custom endpoint. Contract:

- Read→write is synchronous with **no `await` between `readProvidersRaw()` and the tmp+rename**. This removes the *intra-process* lost update only — a second dashboard or Electron instance on the same `$HOME`, or a hand edit, can still race. Matching `auth.json`'s lockfile is explicitly out of scope, so the remaining window is accepted, not eliminated.
- **Preserves every top-level key other than `providers`.** `providers.json` also holds `roles`, `rolePresets` and `activePreset` (`role-manager.ts`). `PUT` preserves them by mutating a parsed `fileData`; a `PATCH` that writes `{ providers }` would silently destroy the user's role configuration. This is the single highest-consequence invariant of the endpoint.
- **Field semantics are explicit, not "partial" by implication:** an omitted `baseUrl` / `api` preserves the existing value; an omitted `apiKey` preserves it; the `***` sentinel also preserves it; only an explicit non-sentinel value replaces it. Renaming is **not** supported through `PATCH` (the health cache is keyed by name) — a rename is a `DELETE` plus a `PATCH` upsert.
- Inherits from `PUT`: masked-sentinel guard, `RECURSIVE_PROXY` self-pointing guard, atomic tmp+rename, `credentials_updated` broadcast, `refreshModelRegistry()`.
- Does **not** inherit `PUT`'s blank-name guard, which iterates body keys. The name arrives as a URL segment, so `PATCH /api/providers/%20` needs its own rejection. Names are percent-encoded in the path (`providers.json` keys may contain `/`).
- Health cache: `PATCH` calls `retainProviderHealth` with the **full** key list (it prunes to the set — passing one name would wipe every other pill); `DELETE` drops only its own entry.
- The response does **not** wait on the probe. `PUT` awaits a probe per provider at an 8 s timeout each; inherited per-edit that cost lands on every keystroke-to-save. The row renders a pending pill and reconciles from the cached health on the next read.
- Registration: `ROUTE_TIERS` entry (`operate`) **and** an MCP manifest row or denylist entry — `mcp-manifest-completeness.test.ts` binds `/api/providers` exactly and would fail on an unbound `/api/providers/:name`. Both its route-tier check and its manifest-binding check enforce this; the runtime gate does not (`routeTier()` falls back to `operate`).
- Name encoding: percent-encoded path segment. A provider literally named `..` is unreachable through the routes (path normalisation) — accepted; `PUT` remains available for that pathological case.

*Alternative rejected:* client-side read-modify-write against the existing `PUT`. Two concurrent writers lose-update with no ETag, and the client would have to hold the full map to edit one row.

### D4 — The section owns the flow; the dialog is presentation only

Poll state (auth-code polling, device-code polling, their timers and the 3-consecutive-failure abort) lives in the **section**, not in the dialog component. Closing the dialog unmounts presentation, never an in-flight flow; a flow that completes after close still lands on the section's `handleChanged`. Section unmount (tab or route change) still ends the flow — the guarantee is scoped to dialog close, not to navigation.

Three details the lift must carry, each currently implicit in the per-row component:

- **Per-provider keying.** Today each `OAuthProviderRow` instance owns its timer and failure counter, so two concurrent flows are isolated by construction. Lifted to the section, poll state must be keyed by provider id or one flow's cleanup clobbers another's.
- **The poll reads the raw `/status` array, not the rendered list.** The rendered list is filtered to configured rows; a poll watching that filtered state would never observe the provider *becoming* configured, and the login would never complete.
- **The device-code poll has no failure budget today** (empty catch, retries until expiry) while the auth-code poll aborts after 3. That asymmetry is pre-existing; the rewrite preserves it deliberately rather than silently adopting one or the other.

This also bounds the dispatch-site count. There are **two** `PROVIDER_AUTH_EVENT` dispatch sites today (the auth section, and the LLM-providers save task). The redesign must not increase that: the custom-endpoint write paths funnel through one call site, not one per control.

*Consequence to spec:* `landing-page-onboarding` currently excludes "writes that complete server-side after the initiating component unmounts" from its dispatch contract. That bound widens, since D4 makes the case reachable by design rather than by accident.

### D5 — Catalogue availability is a separate signal

A new `GET /api/provider-auth/catalogue-ready` → `{ ready: boolean }`. Two corrections to the naive version:

- The cache is **never reset on disconnect** — `latest` is assigned only on a `providers_list` arrival, so `latest === null` means "no bridge has pushed *since server start*", not "no session connected". The cache gains an explicit invalidation when the last bridge disconnects, or the signal is a lie after the first disconnect. A stale-but-non-null catalogue is the residual case: a key added while no session is connected stays invisible until the next push, so the unavailable-state copy says "may be out of date", never "nothing configured".
- The unavailable state is a **per-source notice**, not a replacement for the list. OAuth rows come from the local handler registry and do not depend on the catalogue at all; substituting a whole-list message would hide configured Subscription rows — the very failure this decision exists to prevent.

The list therefore renders: **credentials** / **no credentials** / **credentials + "API-key provider list unavailable" notice**.

*Alternatives rejected:*
- Adding a field to the `/status` response — breaks the bare-array contract `provider-auth-ui` pins.
- Inferring from "zero `api_key` rows" — defeated on a machine whose catalogue holds only `custom` providers, which `_buildAuthStatus` skips; that machine would be told its provider list is unavailable when it is merely all-custom.
- A response header — invisible to non-browser consumers of the same route.

Cost: one more route needing a tier + manifest entry. Accepted for an unambiguous signal on the failure mode the redesign newly makes user-visible.

### D6 — Row identity and precedence across the two fetches

Rows are keyed by `(source, id)` where source is `auth` or `custom`, not by `id` alone. `_buildAuthStatus` skips api-key rows for `custom` catalogue ids but still emits OAuth rows for them, so a `providers.json` key equal to a handler id (`anthropic`) otherwise yields two rows with the same `id`. Precedence when both exist: the auth row renders as Subscription, the custom row renders as Custom endpoint, and both are shown — they are genuinely two different things — with the custom row labelled by its `providers.json` name.

A failure of `/api/provider-auth/status` must not hide custom-endpoint rows, and vice versa: each source renders independently with its own inline error, preserving `provider-auth-ui`'s "remain interactive so the operator can still reach the controls that repair credentials".

### D7 — `/handlers` and the `supported` gating are removed

`provider-auth-ui`'s disabled-with-tooltip requirement and `provider-auth-server`'s matching UI mandate both go. The gating is already inert: OAuth rows are built from `getAllHandlers()`, the same source `GET /api/provider-auth/handlers` returns, so the "catalogue OAuth provider without a handler" case cannot arise from a real payload. The endpoint itself is **retained** (other consumers, and removing a public route is a separate decision); only the client's `fetchHandlerIds` / `supported` gating and the two spec requirements are deleted.

### D8 — Health pills stay scoped to custom endpoints

`provider-connection-test` says "**Each** provider row in Settings → Providers SHALL render a health pill". After unification most rows are OAuth/api-key/environment rows with no cached health, which would read "not tested" forever. The requirement is re-scoped to custom-endpoint rows — the only rows a probe is defined for.

## Risks / Trade-offs

- **D1's table is the whole change's correctness surface.** → Spec it as scenarios per row kind (including the env-var-on-an-OAuth-id case that broke two drafts), and table-drive the unit tests off the same matrix.
- **D2 can refuse a write a user genuinely intended.** → 409 carries an actionable message naming the existing credential's type and the remove-first path; the refusal is never silent.
- **Restructuring `ProviderAuthSection.tsx` risks its scar-tissue invariants** (3-failure abort, peer-hint latch, inline-error-not-ErrorBoundary). → Those tests are rewritten first against the new structure, and the invariants are restated as spec scenarios so a rewrite cannot quietly drop them.
- **`configured` and `authenticated` now coexist with different meanings.** → Genuine ambiguity cost, accepted: widening `authenticated` would change landing-page readiness gating. Both are documented at the type.
- **D5 adds a route for one boolean.** → Accepted over breaking a pinned response contract or shipping an inference with a known false case.
- **The redesign hides 35 providers behind a dialog.** → Picker is searchable over the full catalogue and the Add control names the available count; this is the discoverability trade the change deliberately makes.

## Migration Plan

Server changes are additive (new fields, new routes, a new refusal on an existing write path). Deploy order does not matter: an old client ignores `configured`/`source`, and a new client against an old server sees them `undefined`.

**The new client must tolerate an old server.** `configured` would be `undefined` there, and a filter on a falsy value drops *every* row — rendering an empty list while credentials exist, precisely the regression this change exists to prevent. The client filter is therefore `configured ?? authenticated`, which degrades to today's behaviour against a server that does not send the field.

The one behavioural change on an existing path is D2's cross-type refusal, which can reject a write the old client would have accepted. It is a bug fix, but it is user-visible.

Rollback: revert the client for the UI, revert D2 alone if the refusal proves too strict. Writes already made by the new UI persist in `auth.json` / `providers.json` — correct, but not state-restoring.

## Open Questions

None open.

*(Settled in the mockup loop: the Add picker **groups by kind** — `Subscriptions` / `API keys` / a pinned `Custom endpoint` — with one search field filtering across all groups, per `mockups/add-dialog.html:143-149`. Affects presentation only; no spec or task depends on the choice.)*

*(Previously listed here and now decided, because it would have changed the task breakdown: an Environment-badged row offers **no** "replace with a stored key" shortcut in this change. Adding one is a new credential-write surface with its own spec scenario and task; the row documents its `envVar` and nothing more.)*
