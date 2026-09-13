## Context

See proposal.md — Why. Relevant current state:

- Strip: `App.tsx` mounts `composer-context-strip` (refresh + `ChatViewMenu` + `ComposerSessionActions`). `ComposerSessionActions` renders labelled groups via `GroupLabel` + `Divider`: `OPENSPEC` → `GIT` (`WorktreeActionsMenu`) → `STATUS` (`SessionCardBadgeSlot` inside `<fieldset disabled={streaming}>`, 40% opacity while streaming).
- Quota plugin: `package.json` `claims[]` declares `{ slot: "content-inline-footer", component: "QuotaWidget" }`. `QuotaWidget` (`src/client.tsx`) reads `useQuota()` → `providers[]` with `windows[]`, computes `worstWindow()` per provider, renders one mini-slider row; click → `QuotaDialog` pre-selected.
- Slot props for `content-inline-footer` are `{ session, pluginContext }` — `session.model` is already available to a claimant; the plugin just doesn't use it.
- Quota provider ids = `SUPPORTED_PROVIDERS` in `packages/quota-plugin/src/providers.ts`: `anthropic`, `github-copilot`, `kimi-coding`, `openai-codex`, `openrouter`, `synthetic`, `zai` — chosen to equal pi's provider ids, so a session model string `<provider>/<modelId>` prefixes match directly. `/api/quota` puts fetched providers in `providers[]` (each with a server-set `stale?: boolean`) and enabled-but-unfetchable ones in `unavailable[]`.
- Claim manifests are whitelisted by `validateClaim` (`manifest-validator.ts`); unknown claim fields are silently dropped. Any new claim field would need validator + `PluginClaim` + `ClaimEntry` changes.
- `Divider` / `GroupLabel` are module-private to `ComposerSessionActions.tsx`; the client depends on `dashboard-plugin-runtime`, never the reverse.
- Mockup: `tmp/mockups/quota-context-strip/index.html`, variant B (B1 adapter match, B2 no-adapter note, B3 mid-session switch, C narrow wrap).

## Goals / Non-Goals

**Goals:**
- Quota reads as a sibling group of `OPENSPEC` / `GIT` in the strip, using the strip's chip vocabulary (10px, 4px radius, 1px border).
- A generic `composer-context-group` slot so *any* plugin can add a labelled group; quota is the first claimant.
- Streaming does NOT dim the group.
- Session-provider emphasis is derived from `session.model`, no new state anywhere.

**Non-Goals:**
- No change to `/api/quota`, the server plugin, pace math, or `QuotaDialog`.
- No change to `content-inline-footer` semantics (flows-plugin keeps it).
- No mobile action-menu entry; on narrow widths the strip wraps (variant C) — same as today for GIT.
- No i18n of provider display names beyond what the plugin already does.

## Decisions

### D1 — New slot `composer-context-group`, not reuse of `session-card-badge`
`session-card-badge` already lands in the strip (STATUS group) for free, but it sits inside `<fieldset disabled>` that greys everything while streaming — exactly when a usage meter matters most — and it carries the `STATUS` label, which is wrong for quota. A dedicated slot lets the consumer render its own `Divider + GroupLabel + children` per claim and skip the fieldset.
Alternatives: (a) special-case quota inside `ComposerSessionActions` — couples core to a plugin, violates the zero-plugin-references shell rule; (b) extend `session-card-badge` payload with `{ exemptFromStreamingGate }` — leaks a strip concern into a card-badge slot used elsewhere.

### D2 — Slot payload: `{ component }` only; context props `{ session, pluginContext }`
No `label` claim field: `validateClaim` would drop it, and a host-rendered label cannot be suppressed when the claimant has nothing to show (violating "no data → no group"). Context props mirror `content-inline-footer` (`SlotPropsMap` declares `{ session, pluginContext }`; the consumer passes `{ session }` as props and plugin context arrives via the `CurrentPluginLayer` React context, exactly as for the footer slot) so the quota plugin's move is a one-line `package.json` edit plus the widget rewrite. `multiplicity: "many"`, `payloadTier: "react-only"` in `SLOT_DEFINITIONS`, priority-ordered like every other `many` slot. Tier separation is architectural (descriptor slots have their own consumers); no runtime check exists or is added.

### D3 — `ComposerContextGroup` primitive exported from the runtime; claimant owns label + emptiness
`dashboard-plugin-runtime` exports `ComposerContextGroup({ label, children, testId? })`: `<span className="inline-flex items-center gap-1 shrink-0" data-testid={testId}>` → leading divider (`inline-block h-3 w-px bg-[var(--border-secondary)] mx-0.5 flex-shrink-0`), uppercase label (`text-[9px] uppercase tracking-wider text-[var(--text-muted)] mr-0.5 flex-shrink-0`, testid `${testId}-label` only when `testId` is given), children. The classes mirror the host's private `Divider`/`GroupLabel` so plugin groups look like `GIT`/`STATUS`. **The host's own groups are NOT refactored onto the primitive**: `OPENSPEC` has no leading divider, `STATUS` wraps a `<fieldset>` (flow content, illegal inside a `<span>`), and its groups carry two test ids each — adopting the primitive would change existing DOM for no user-visible gain. The ~6 duplicated class lines are an accepted trade-off (surgical change over DRY).
`ComposerContextGroupSlot` mirrors `ContentInlineFooterSlot` exactly (`useSlotClaimsVersion` + `forSessionRendered` + `useSlotIntents`, `renderClaim` with `{ session }`); `composer-context-group` is added to `SessionScopedSlot` so `shouldRender` predicates receive the session. The strip is `flex-wrap`; the primitive's single non-shrinking unit keeps the label with its content (an orphaned label was observed in the first mockup render). A claimant returns `null` when it has nothing to show.

### D3b — Strip early-return guard includes the new slot
`ComposerSessionActions` returns `null` when `!showOpenSpec && !showStatus && !showGit`. Add `hasContextGroup = useSlotHasClaimsForSession("composer-context-group", safeSession)` to that guard, otherwise a session with no openspec dir, no worktree and no badge claim never shows quota.

### D4 — Position: after GIT, before STATUS
Quota is read-only context; STATUS holds actionable plugin badges gated by streaming. Read-only before actionable keeps the "disabled while running" region contiguous at the strip's end.

### D5 — Provider matching is pure derivation from `session.model`
`providerForModel(model)` returns the prefix before the first `/`, or `undefined` when `model` is undefined or has no `/` (custom/aliased models). One rule, applied only when `providers.length > 0`:
- provider found in `providers[]` → that chip first (`data-session-provider="true"`, accent ring via `box-shadow: 0 0 0 1px var(--accent) inset`, full opacity), rest at reduced opacity;
- provider defined but absent from `providers[]` (disabled, in `unavailable[]`, or no adapter at all) → prepend a non-interactive dashed note `<modelId> · no quota` (`modelId` = part after the first `/`; `aria-label` spells it out), no ring, every chip at reduced opacity (none is the session's);
- provider `undefined` → no ring, no note, all chips at full opacity.
`providers` = `/api/quota` `providers[]` filtered to `windows.length > 0` (the widget already applies this filter; keep it). `providers.length === 0` → the widget returns `null` (no group), regardless of the session model. No plugin state; relies on `session.model` being updated by the bridge on a mid-session model switch (verified manually in integration).
Test handles: group `quota-context-group` (label `quota-context-group-label`), chip `quota-chip-<provider>`, note `quota-no-adapter-note`. Dimmed chips carry `data-dimmed="true"`; the ringed chip carries `data-session-provider="true"`; a stale chip carries `data-stale="true"`. The old `quota-widget` / `quota-slider-*` ids go away with the footer widget.
Alternative rejected: reading the composer's local draft model selection — that's `CommandInput` state, not session truth; `session.model` is what the bridge reports as actually set.

### D6 — Chip content: provider name + every window inline + stale tag; NO model id
Per user choice: ring alone marks the session provider; the model id already shows in the composer toolbar a few px below. Each window: a window-label span, the bar, a percent span, with pace colour from the existing `computePace()` severity (green/orange/red, muted when stale). The server-set `ProviderQuota.stale` flag (retained figures after a failed refresh) adds a `not live` tag — same flag and same `useT` string `QuotaDialog` already renders; the chip styles it dashed. No client-side heuristic. Ring colour uses the plugin's established `var(--accent, #3b82f6)` fallback. All new user-visible strings (`Quota` label, `no quota`, chip `aria-label`) go through `useT` with inline English fallback + `zh-CN`/`hu` catalog keys, like every existing string.

### D7 — Quota widget keeps `QuotaDialog` on click
Chip is a `<button>` with `aria-label="<Provider> quota, 5h 14%, 7d 32%"`; click opens the existing dialog pre-selected. The no-adapter note is a `<span>`, not a button.

## Risks / Trade-offs

- [Strip crowding on mid widths — OPENSPEC + GIT + QUOTA + STATUS may push to 2–3 lines] → groups are single flex items so wrapping between groups is clean; quota chips carry only enabled providers (typically 1–2, ~300px). Matches variant C.
- [A non-shrinking group with many enabled providers can exceed a narrow (375px) viewport and clip horizontally] → accepted trade-off: the alternative (letting chips wrap inside the group) re-introduces the orphaned label. Verified manually at 375px with 2 providers; a compact/overflow mode is out of scope.
- [Adding a `SlotId` is a public API change for third-party plugins] → additive only; minor semver. Versions across workspaces move in lockstep at `release-cut`, so the quota plugin's `pi-dashboard-shared` range is bumped there, not here. A newer quota plugin on an older dashboard fails manifest validation (unknown slot id throws; the loader then skips the **whole plugin**, settings included) — accepted; plugins are published with the dashboard, and the failure is loud in the server log.
- [`session.model` can be undefined (session not yet reported) or lack a `/`] → `providerForModel` returns `undefined` → no ring, no note; plain provider list. Test explicitly.
- [Provider id ↔ model prefix drift (e.g. `openai` vs `openai-codex`)] → matching is exact on pi's provider id, which `SUPPORTED_PROVIDERS` mirrors; a drift degrades to the `no quota` note beside un-ringed chips, never to a wrong ring. `providerForModel()` is the single place to extend.

## Migration Plan

1. Land shared slot id + props + consumer (no claimant yet) — inert.
2. Mount `ComposerContextGroupSlot` in `ComposerSessionActions` + extend the early-return guard — still inert.
3. Flip quota plugin claim + widget rewrite + header comment/AGENTS row in one commit; `npm run reload` not needed (client + shared only → `npm run build && /api/restart`).
4. Rollback: revert step 3 alone restores the footer widget; the empty slot renders nothing.

## Open Questions

- Should `docs/` list `composer-context-group` in the plugin-authoring slot table with a screenshot? (Deferred to DocScribe at closeout; does not affect specs or tasks.)
