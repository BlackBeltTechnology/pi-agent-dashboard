# Keep the model selector openable when the catalogue is empty

## Why

`ModelSelector` computes `hasModels = !!models && models.length > 0` and then renders the
trigger as `onClick={() => hasModels && setOpen(!open)}` with `disabled={!hasModels}`
(`packages/client/src/components/settings/ModelSelector.tsx:139,310,316`). With an empty
catalogue the control cannot be opened at all.

That interacts badly with how the catalogue is delivered: models are pushed at session start.
An operator who configures a provider **after** the session started sees an empty list, a dead
button, and no way forward — the session appears to have no models and never recovers.

The recovery action already exists but is unreachable in exactly this state:

- change `reload-models-on-selector-open` (treated here as **already applied**) makes opening
  the dropdown request a fresh model list — but opening is what's disabled;
- the manual ↻ refresh control lives **inside** the popover footer
  (`ModelSelector.tsx:408`), so it is behind the same closed door.

Net: the empty state is the one state where refresh matters most, and the only state where
every refresh affordance is unreachable.

## Design mockups

Interactive state/decision boards (served via `serve_mockup mockups/`; both `data-theme`s):

- `mockups/empty-model-selector.html` — every selector state: dead button (today), refreshing,
  genuinely empty, empty+errored, partial failure.
- `mockups/selector-decisions.html` — the five decisions below rendered as pickable option cards
  (recommended = blue border), with the chosen option marked.

## What Changes

- **Always openable.** The trigger SHALL no longer be `disabled` when the model list is empty.
  Opening with an empty catalogue is allowed.
- **Explicit empty state.** An opened-but-empty popover SHALL show an empty state (refreshing /
  "no models available") instead of an empty pane or a dead button.
- **Open triggers the refresh in the empty case.** The existing reload-on-open transition SHALL
  fire when the list is empty too (once per open transition, not per render), so the operator's
  first click is the recovery action: configure provider → open selector → catalogue re-fetched
  → models appear without restarting the session.
- **Recovery link when genuinely empty (D4-A).** Once an open-triggered refresh has completed and
  the list is still empty, the empty state SHALL show a `⚙ Open provider settings` link (plain
  icon+label, no arrow) that navigates to Settings → Providers. The link SHALL NOT show *before*
  the first post-open `models_list` arrives (while `awaitingRefresh`), so a still-loading catalogue
  never renders a premature "no models" affordance.
- **Empty + error is reopen-to-retry (D5-B).** When the empty state coincides with a refresh error,
  it SHALL present the same `⚙ Providers` link and rely on close→reopen as the retry (no inline
  Retry control): opening is the only refresh trigger, consistent with the removed manual ↻.
- **Partial-failure footer is a thin hint (D1-B).** When some providers resolved and at least one
  reported a refresh error, the populated dropdown SHALL replace the current per-provider footer
  message with a single `⚠ N provider unavailable` line + the same plain `⚙ Providers` link — no
  provider names, no arrow. Per-provider names and error detail move to Settings → Providers
  (covered by `surface-provider-health-in-settings`).

**Out of scope (follow-ups):**
- The Settings → Providers health pill + verbatim error text (D2/D3) — its own change
  `surface-provider-health-in-settings`. This change only links to that panel; it does not build it.
- Changing *when* the bridge pushes `models_list` beyond the open-triggered refresh already
  covered by `reload-models-on-selector-open` (e.g. pushing on provider save).

## Capabilities

### Modified Capabilities

- `model-selector`: the trigger is openable with an empty catalogue (currently `disabled` when
  `models.length === 0`); an opened-empty popover renders an empty state, the reload-on-open
  transition fires in the empty case, a post-refresh empty list shows a `⚙ Open provider settings`
  link (D4-A) gated on `awaitingRefresh` clearing (D5-B reopen-to-retry), and the per-provider
  refresh-failure footer is replaced by a thin count + `⚙ Providers` link (D1-B).

## Impact

- `packages/client/src/components/settings/ModelSelector.tsx` — drop the `hasModels` disable on
  the trigger; add an `awaitingRefresh` flag (set on the open-transition `request_models`, cleared
  on the next `models_list` for the session); empty-state body with the gated `⚙ Open provider
  settings` link; replace the per-provider `refreshErrors` footer with the thin `⚠ N provider
  unavailable · ⚙ Providers` line.
- Navigation: a callback/route to open Settings → Providers (reuse the existing settings-open path;
  no new route if one exists).
- Tests: `packages/client/src/components/__tests__/ModelSelector.test.tsx` — openable with
  `models: []`; no link while `awaitingRefresh`; link shown after a post-open empty `models_list`;
  reopen re-fires refresh (no inline Retry); thin footer with `refreshErrors` + non-empty list.
- Additive and reversible. No server, extension, or protocol change. No behaviour change once a
  catalogue is populated cleanly.
- Depends on `reload-models-on-selector-open` being applied (this change assumes the
  reload-on-open transition + awaited-refresh exist and only extends them to the empty case).
- Pairs with `surface-provider-health-in-settings` (the `⚙ Providers` destination). Ships
  independently — the link targets the existing Settings → Providers panel even before the pill
  work lands.

## Discipline Skills

- `review-code` — non-trivial client component change before commit.
