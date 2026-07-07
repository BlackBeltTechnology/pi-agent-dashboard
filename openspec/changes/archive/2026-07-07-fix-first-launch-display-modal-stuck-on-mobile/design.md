## Context

The modal's dismissal has a single point of failure — one fire-and-forget WS frame — with no local fallback and no connect-time recovery. Display-prefs is the only browser preference lacking a connect snapshot; every sibling (`pinned_dirs`, `favorite_models`, `workspaces`, `openspec`, `terminals`) self-heals on reconnect. On mobile the socket is disproportionately non-`OPEN` at the moment of the PATCH, so the one close-signal is dropped and never resent.

## Goals / Non-Goals

**Goals**
- Modal closes instantly on Skip/Continue regardless of WS state.
- A missed `display_prefs_updated` broadcast self-heals on the next reconnect.
- A failed/denied mount GET does not spuriously open the modal.

**Non-Goals**
- No change to the `DisplayPrefs` schema, presets, or the PATCH/broadcast wire format.
- No new endpoint, no protocol version bump.
- No auth/`trustedNetworks`/ticket changes (the RC3 auth-denial path is out of scope; only the client's conflation of failure with "no prefs" is fixed).

## Decisions

### D1 — Optimistic local close (RC2), client-only, primary and SUFFICIENT fix
`seed(key)` applies `DISPLAY_PRESETS[key]` locally **unconditionally** and calls `onClose(prefs)` on **every** path — PATCH 200, non-2xx, or thrown fetch. App.tsx `onClose` stops being a no-op and calls `setDisplayPrefs(prefs)`. The PATCH 200 body `{ displayPrefs: merged }`, when readable, refines the local value (server may deep-merge differently than the raw preset), but is never a *precondition* for closing. The misleading `catch { /* broadcast will reconcile */ }` comment is removed.

- **Critical correctness point (from doubt-review):** the current code calls `onClose()` unconditionally (after the try/catch). A naive "read response then close" rewrite would call `onClose` ONLY on a readable response — stranding the modal open on a failed PATCH, a strict regression. The chosen preset is the source of truth precisely so a failed PATCH still closes.
- **Why sufficient:** covers WS-OPEN + PATCH-success, WS-not-OPEN + PATCH-success, AND WS-not-OPEN + PATCH-failure. No other fix is needed to dismiss the modal. The broadcast/D2 become resilience only.
- **Alternative rejected:** a client-side timeout that force-closes after N seconds — hides the bug, leaves `displayPrefs` undefined (chat renders with default gating), and re-opens on the next mount.

### D2 — Connect-time snapshot (RC1), server-side, RECONNECT-RESILIENCE (not the stuck-modal fix)
Add one `sendTo(ws, { type: "display_prefs_updated", prefs })` in `wss.on("connection")` alongside the existing `pinned_dirs_updated`/`favorite_models_updated` sends, guarded by `typeof preferencesStore.getDisplayPrefs === "function"` (matching the adjacent stub-safety guards) AND only sent when prefs are **defined** — a genuinely seedless install must still send nothing so the first-launch modal opens exactly once.

- **Scope correction (from doubt-review):** D2 does NOT fix the stuck modal (D1 already does, in every case). D2's value is: a *seeded* client that missed a live `display_prefs_updated` broadcast (socket not OPEN at broadcast time) recovers current prefs on its next reconnect instead of only on a full page reload. It cannot help when the PATCH never seeded prefs, and only acts after a reconnect round-trip — so it is not a substitute for D1.
- **Why still worth doing:** makes display-prefs behave like every sibling pref (parity), and covers the cross-tab / mid-session-update-missed case.
- **Edge:** the client's `display_prefs_updated` handler already `setDisplayPrefs(msg.prefs)` unconditionally (`useMessageHandler.ts:884`); receiving a defined snapshot flips `displayPrefs` from `undefined`, closing a stuck modal automatically on reconnect.

### D3 — Distinguish failed GET from empty prefs (RC3), client-only, hardening
Mount fetch opens the modal only when `r.ok && body.displayPrefs === undefined`. On `!r.ok` (403/flap) it does NOT leave the modal-eligible state — it leaves `displayPrefs` unset but must not present the first-launch UI as if it were a fresh install. Keep `displayPrefsLoaded` semantics so the rest of the app proceeds, but gate the modal render on a distinct "confirmed seedless" signal rather than "loaded && undefined".

- **Why:** stops the modal appearing at all when the real problem is a denied/transient request (the auth path), which is the worse UX (undismissable AND meaningless).
- **Implementation constraint (from doubt-review):** `setDisplayPrefsLoaded(true)` currently sits in the fetch's `finally`, so it runs even after the `if (!r.ok) return` early-exit — meaning `loaded && displayPrefs === undefined` is true on ANY failed GET. Fix: add a distinct `displayPrefsSeedless` flag set only when `r.ok && body.displayPrefs === undefined`, keeping `displayPrefsLoaded` semantics intact for the rest of the app.
- **CRITICAL gate formulation (from cross-model doubt-review):** the modal render gate SHALL be **`displayPrefsSeedless && displayPrefs === undefined`**, NOT `displayPrefsSeedless` alone. A seedless-only gate is a bug: `onClose`→`setDisplayPrefs(prefs)` (D1), a cross-tab `display_prefs_updated` broadcast (`useMessageHandler.ts:882-885`), and the D2 connect snapshot all close the modal by *defining `displayPrefs`* — none of them touch `displayPrefsSeedless`, so with a seedless-only gate the modal would never close. Coupling the gate to `displayPrefs === undefined` makes all three close paths work AND keeps the failed-GET guard (seedless stays false on `!r.ok`, so the modal never opens spuriously).

## Interaction: seedless first-launch must survive D2

The one risk of D2 is masking a genuine first launch. Guard: the connect snapshot sends **only when `getDisplayPrefs()` returns defined**. A fresh install returns `undefined` → no snapshot → mount GET returns `undefined` → modal opens once → user picks preset → PATCH persists + D1 closes locally + broadcast + future connects now send the snapshot. Verified by the "seedless-first-launch still shows the modal exactly once" scenario.

## Risks / Trade-offs

- **PATCH-failure close semantics (from cross-model doubt-review) — explicit definition of "dismiss":** "dismiss" on a failed PATCH is a **current-session dismiss only**, NOT persisted first-launch completion. Because a failed/non-2xx PATCH never reaches `preferencesStore.setDisplayPrefs()` (`preferences-display-routes.ts:40-49`), the server stays seedless (`getDisplayPrefs()` returns `undefined`), so a subsequent reload or a new tab WILL re-open the first-launch modal. This is acceptable and satisfies contract 1 (dismiss the current instance) but is a deliberate trade-off against the "exactly once" spirit: a user who taps while offline gets prompted again next load. The current tab also shows the chosen preset while the server has none — a transient un-persisted UI state, low-stakes for a display-only preset. **Optional hardening (not required):** retry the PATCH on the next successful WS reconnect, or surface an "unsaved" hint. Chosen default: no retry — the re-prompt on next load is self-correcting.
- **Double-apply:** D1 sets prefs locally, then the broadcast/snapshot sets the same value again — idempotent (`setDisplayPrefs` with equal value), no visible effect.
- **RC3 scope:** does not fix the underlying 403 (auth/`trustedNetworks` provisioning for LAN/remote mobile) — that is a separate concern; this change only stops the modal from being the symptom surface.

## Migration

None. No schema or wire-format change; no persisted-data migration. Existing seeded installs immediately benefit from the connect snapshot on their next reconnect.

## Open Questions

- Should the connect snapshot also send when prefs are `undefined` with an explicit `{ prefs: undefined }` so the client can positively distinguish "seedless" from "not yet told"? Current design sends nothing when undefined (simplest, preserves first-launch); revisit only if RC3's distinct seedless signal proves insufficient.
