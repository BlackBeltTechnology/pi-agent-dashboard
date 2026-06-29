# improve-dashboard-attention-routing

## Why

The dashboard's single most important daily question — *"which of my running
sessions needs me right now?"* — is the hardest to answer at a glance. Grounded
in the live UI (14 active sessions across folders) and the authoritative source
(`packages/client/src/components/SessionCard.tsx`,
`packages/client/src/lib/session-status-visuals.ts`), three concrete defects:

1. **The `ask_user` (blocked-on-you) state has no dedicated rail or dot color.**
   `deriveRailBgColor` and `deriveDotColorWithFlags` have **no `ask_user`
   branch** — a session blocked waiting for the user falls through to the
   `active`/`idle` path and renders the **same green rail and green dot as a
   finished-idle session**. The only differentiators are (a) purple
   `ActivityIndicator` text and (b) the ambient `card-input-pulse` background
   animation, which `prefers-reduced-motion` and idle-animation throttling can
   suppress. The `session-status-visuals.ts` docstring asserts *"dot,
   source-icon tint, and rail always agree"* — but `ask_user` was never added to
   that precedence chain. The most urgent state is the least visible.
   Violates **Von Restorff (isolation)** and **Nielsen H1 (visibility of system
   status)**.

2. **`"Waiting for input"` is one label with two opposite meanings.**
   `ActivityIndicator` emits the identical string `"Waiting for input"` for
   `ask_user` (agent is BLOCKED, act now — purple text) and for `idle`/`active`
   (turn finished, passive — faint grey text). The two states are distinguished
   **only by hue**, which fails users who scan quickly or have color-vision
   deficiency. Violates **Nielsen H4 (consistency & standards)** and
   **WCAG 2.2 §1.4.1 (use of color)**.

3. **No urgency surfacing.** Sessions render in list order, not urgency order,
   and there is no per-folder/global "N need you" rollup. With many active
   sessions a blocked one can sit anywhere — even below "Show N ended sessions".
   Violates **Nielsen H6 (recognition rather than recall)** and increases scan
   cost (cognitive load).

This change makes "needs you" a first-class, multi-channel, scannable state
without touching server event semantics — it is a client-render + token-layer
change over the existing `currentTool`/`status`/`unread` signals already
broadcast.

## What Changes

- **MODIFY** `packages/client/src/lib/session-status-visuals.ts`:
  - Add an `ask_user` branch to `deriveDotColorWithFlags` and
    `deriveRailBgColor` so the blocked-on-you state gets a dedicated
    `--status-needs-you` color in dot + rail + source-icon tint (restores the
    "dot, rail, icon always agree" invariant the docstring already promises).
  - Precedence (highest → lowest): `hasError` → `ask_user` (chat-routed, not
    widget-bar) → `resuming`/`isRetrying` → `streaming`/`currentTool` →
    `active`/`idle` → `ended`.
- **MODIFY** `packages/client/src/components/SessionCard.tsx`
  (`ActivityIndicator`):
  - Split the overloaded label. `ask_user` (chat-routed) → **"Needs you"** with
    the comment-question icon; `idle`/`active` (turn finished) → **"Idle"**
    (muted). Convey the difference by **icon + label + color + dot shape**, not
    hue alone.
- **MODIFY** the theme layer (`packages/client/src/**` theme CSS / token
  source): introduce semantic status tokens `--status-needs-you`,
  `--status-working`, `--status-idle`, `--status-error` mapped per existing
  theme (studio / earth / athlete / gradient), replacing hardcoded
  `purple-400` / `green-500` / `amber-500` literals in the status helpers. This
  is the `ui-contract` step — status color becomes a token, not a literal.
- **MODIFY** the dot rendering to encode urgency by **shape** as a non-hue
  channel: needs-you = filled ●, working = half/pulsing ◐, idle = ring ○,
  error = ✕. Satisfies WCAG color-not-sole-channel even under reduced-motion.
- **NEW** folder-level "needs-you" rollup: a compact, clickable affordance on
  each folder header (and optionally a global header pill) reading
  *"N need you"* that, when clicked, scrolls to / filters the blocked sessions.
  Hidden when count is 0.
- **NEW** optional urgency sort: a per-folder toggle (default off, opt-in) that
  floats `ask_user` sessions to the top of their folder's active list so they
  are never below the fold. Persisted via existing display-prefs.
- **DOCUMENTATION** — update `docs/architecture.md` status/attention section and
  add the new `--status-*` tokens to the relevant `docs/file-index-client.md`
  rows.

## Impact

- Affected specs:
  - `session-card-status` (MODIFIED) — add `ask_user` rail + dot color
    precedence and the shape channel.
  - `ask-user-card-indicator` (MODIFIED) — disambiguate the "Waiting for input"
    label into "Needs you" vs "Idle"; require non-hue differentiation.
  - `session-attention-routing` (ADDED) — needs-you rollup + opt-in urgency
    sort.
- Affected code: `session-status-visuals.ts`, `SessionCard.tsx`
  (`ActivityIndicator`, dot/rail render), theme token source, folder header
  component, display-prefs.
- No server / protocol / event-semantics change. Client render + token layer
  only. Reuses `currentTool`, `status`, `unread`, `useHasWidgetBarPrompt`
  already in `DashboardSession`.
- Orthogonal to `add-server-push-notifications` (that pushes *when away*; this
  improves *in-dashboard* scannability). They share the same trigger semantics
  but no code.
