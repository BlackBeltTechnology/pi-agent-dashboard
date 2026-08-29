## Why

`useProvidersReady()` refetches on mount, on window `focus`, and on a `provider-auth-event` custom event (`useProvidersReady.ts:60-72`). The listener is shipped and specified (`openspec/specs/landing-page-onboarding/spec.md` — "Requirement: Providers-ready detection", scenario "Refetch on provider-auth-event"). **Nothing in the client or extension ever dispatches it.** The only occurrences in the repo are the listener, its `AGENTS.md` row, and its own unit test.

The hook is called once, in `App` (`App.tsx:595`), which never unmounts — so there is no remount refetch to paper over the missing dispatch — and its `ready` value drives `LandingPage.tsx:119` (`step1 = providersReady ? "done" : "pending"`).

**The deterministic gap is the same-window credential writes.** OAuth and device-code flows hand the user to a system browser or a `window.open` popup, so returning to the dashboard fires `focus` and the hook already refetches today. The paths that never yield focus are the ones typed in place:

- **API-key save** — the user types a key into the providers settings page and saves. No navigation, no focus change.
- **Custom-LLM-provider save** — same, via `PUT /api/providers`.
- **API-key removal / OAuth sign-out** — the count-**decrement** direction, equally in-place.

Since `add-route-backed-overlay-dialogs`, desktop settings renders as a `RouteBackedOverlay` (`App.tsx:2666`) over a pinned underlay of the launching surface. A user who opens settings from the landing route now has `LandingPage` live behind the dialog, so the onboarding checklist keeps asserting "① Setup credentials — pending" while they type the key, and still asserts it after they save and dismiss. Previously that surface was unmounted and the staleness was invisible; the overlay work turned a latent bug into a visible one.

This was originally an inlined dependency of `add-persistent-onboarding-card`. It is split out because it stands on its own: it fixes a shipped bug in a shipped surface, and it is a hard prerequisite for any future surface that reads readiness without remounting.

## What Changes

- **Export a shared `PROVIDER_AUTH_EVENT` constant** and use it at the listener plus both new dispatch sites. The name is currently a bare string literal duplicated across the listener and its test; adding two more raw copies is how the next surface silently misspells it. This is an **implementation choice, deliberately not a normative requirement** — "no call site repeats the literal" has no observable a test can assert (a unit test can check the constant's value, not the absence of literals elsewhere), and scenario-design's HARD gate rejected encoding an unfalsifiable clause in the spec.
- **Dispatch `PROVIDER_AUTH_EVENT` on `window` after each credential write that succeeds:**
  - `ProviderAuthSection.tsx` — the API-key save, the API-key removal, the **OAuth sign-out**, the OAuth sign-in completion and the device-code completion all already funnel through the single `handleChanged` callback (`:107-111`). One dispatch there covers all five. It goes in `handleChanged`, **never** in `refresh` — `refresh` also runs on mount, and the existing comment at `:104-106` is explicit that "a mount must not look like a credential write".
  - `SettingsPanel.tsx` — the custom-LLM-provider `PUT /api/providers` success path (`:823-830`), which `handleChanged` does not reach. That PUT has **replace semantics**, so the same dispatch covers adding, editing, and deleting a custom provider.
- **Dispatch on each path's existing success branch — do not invent a new success gate.** `handleChanged` is response-blind by construction: it is called *from* the success branch of each write and never sees the response. `ProviderAuthSection` gates on `res.ok` (`:479-482`, `:50-58`); `SettingsPanel` gates on `data.success` (`:829`). Both `PUT /api/provider-auth/api-key` and `DELETE /api/provider-auth/:provider` do return an `{ ok: true }` body (`provider-auth-routes.ts:235,250`), but it is **unconditional** — every non-2xx path returns `{ error }` instead — checking it would add a gate that can never fail while forcing the dispatch out of the single `handleChanged` funnel into five call sites. Rejected: the funnel is the reason this change is two lines.

- **Over-dispatch is accepted; under-dispatch is not.** The event is a *hint to refetch*, not a claim that the count changed. Two paths dispatch on writes that may change nothing: the custom-provider `PUT` fires for any dirty provider field, and an untouched key round-trips as the `"***"` redaction sentinel and is preserved rather than rewritten (`provider-routes.ts:18,150-155`) — so a **base-URL-only or api-type-only** edit of a keyed provider dispatches without writing a credential; and `DELETE /api/provider-auth/:provider` returns `{ ok: true }` even for an already-absent key (`:244-251`, no existence check).

  Not a rename: an existing provider's name is a read-only `<span>` in the UI (`SettingsPanel.tsx:3313-3324`), and a `"***"` sentinel arriving under a name with no saved entry is rejected `400` server-side (`provider-routes.ts:138-143`) — which fails `data.success` and correctly dispatches nothing. Both cost one extra pair of `GET`s and converge on the correct readiness. Narrowing them would require the dispatch sites to diff credential state, which is strictly more machinery than the refetch it would avoid.

Not in scope: any change to `useProvidersReady()`'s own logic, to `LandingPage`, or to the onboarding checklist's step derivation. No new surface. No server, protocol, or config change.

### Explicitly not closed by this change

A `window` event is same-window and only fires while the writing component is mounted. Three residual staleness paths remain, all pre-existing:

1. **Post-unmount completion — both OAuth flows, not just device-code.** The device-code flow is driven by a server-side poller (`provider-auth-routes.ts:263-265`), and the auth-code flow by the temporary callback server's `onCode` → `writeCredential` (`:151-163`). Either writes the credential regardless of the client. If the user closes settings mid-flow, the row's polling is cleared on unmount (`ProviderAuthSection.tsx:159-163`), auth completes later server-side, and no dispatch fires.
2. **Writes from outside these two components** — `pi auth login` in a dashboard terminal pane, a curl, the `pi-dashboard` skill's REST calls. The window already has focus, so no `focus` refetch fires either.
3. **A second browser window.** A write in window A leaves window B stale until B is refocused.

**Alternative considered and rejected: a server→browser broadcast.** The server already calls `notifyBridges()` on every credential write (`provider-auth-routes.ts:92,162,234,249,264`), which would cover all three residual paths. It does **not** reach browsers — `piGateway.broadcast({ type: "credentials_updated" })` targets the bridge WebSocket, and browsers only observe the downstream per-session `models_list`. Covering readiness that way means adding a **new browser-facing broadcast plus a new client subscription** — a protocol surface, for three paths that are rarer than the in-place save and that a refocus already fixes. Rejected as disproportionate to a two-call-site fix; the shipped listener contract is the mechanism this change is completing, not a mechanism it is choosing.

## Capabilities

### New Capabilities
<!-- none — this completes an existing capability's already-specified contract -->

### Modified Capabilities
- `landing-page-onboarding`: the "Providers-ready detection" requirement gains the dispatcher half of the `provider-auth-event` contract. Today the spec says the hook refetches on the event but never says who fires it, which is exactly how the gap shipped.

## Impact

**Client**
- `packages/client/src/hooks/useProvidersReady.ts` — export the `PROVIDER_AUTH_EVENT` name constant; the listener uses it instead of a literal. No logic change.
- `packages/client/src/components/settings/ProviderAuthSection.tsx` — one `window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT))` inside `handleChanged`. No other behaviour change; `onCredentialsChanged?.()` and its `refetchCatalogue` binding (`SettingsPanel.tsx:1881`) are untouched.
- `packages/client/src/components/settings/SettingsPanel.tsx` — one dispatch after the `/api/providers` `PUT` resolves `success: true`.

**Unaffected**
- `useProvidersReady()`'s fetch/derivation logic — consumed as-is; the event it already listens for finally gets fired.
- Server, protocol, WebSocket, config: untouched. Nothing crosses the wire.

- `packages/client/src/hooks/__tests__/useProvidersReady.test.ts` — its literal `new CustomEvent("provider-auth-event")` (`:138`) adopts the shared constant, so the "no call site repeats the literal" clause is not violated by the suite that proves it.
- Directory `AGENTS.md` rows for the touched files, including the `useProvidersReady.ts` row in `packages/client/src/hooks/AGENTS.md:43`, which currently documents a listener with no dispatcher.

**Known pre-existing races, deliberately not fixed here.** `ApiKeyRow.handleSave` has no synchronous in-flight guard — `disabled={busy}` covers only the Save button, while the Enter handler on the key input (`:537`) can re-enter — and `startDeviceCode` overwrites `pollingRef` without clearing a prior interval the way `startAuthCode` does (`:176-178`). (`useAsyncAction`, which drives removal and sign-out, *does* hold a synchronous `pendingRef` guard, so those paths are not affected.) Either can produce a second `handleChanged`, hence a second dispatch. The consequence under this change is one redundant pair of `GET`s, which the over-dispatch clause above already accepts. Fixing the double-submit is a separate concern from wiring the event, and folding it in would make a two-line change a behavioural one.

**Rollback**: two `window.dispatchEvent` calls plus a constant. Reverting restores current (buggy) behaviour. No persisted state, no migration.

## Discipline Skills

- `review-code` — small diff, but it touches the settings credential paths; a pass before commit is cheap.

No `security-hardening`: the event is a same-window, zero-payload notification — no key, no provider id, no PII. A hostile same-origin script could loop-dispatch it into repeated `GET`s, but such a script can already call those endpoints directly, so the event grants no capability. No `performance-optimization`: the delta is one extra pair of `GET`s per user-initiated credential write, on top of the status refetch `handleChanged` already performs; refetches dispatch nothing, so there is no reentrant loop. No `observability-instrumentation`: no new endpoint, job, or external call.
