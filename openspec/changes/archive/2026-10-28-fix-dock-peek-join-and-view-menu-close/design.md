# Design

## Context

- Peek overlay: `regionClass` in `packages/client/src/components/chat/ComposerDock.tsx:489-491` = `absolute -inset-x-px bottom-full z-raised … rounded-t-xl border border-b-0 … shadow-lg`.
- Dock root: `ComposerDock.tsx:510` = `relative z-0 mx-5 -mb-6 … rounded-t-xl border border-b-0 … pb-6 shadow-[inset_0_1px_0_var(--elevation-rim)]`. `z-0` makes a stacking context. That traps the overlay's `z-raised` (10) at level 0 in the parent.
- Chat floating button: `packages/client/src/components/chat/ChatView.tsx:2885-2888` `scroll-to-bottom` (scroll-to-top at `:2877`, also `z-10`) = `absolute … z-10`. It paints over the trapped overlay.
- Bar row: `SummaryBar` in `ComposerDock.tsx:339` adds `border-t` while peeking; the bar button has `hover:bg-[var(--bg-hover)]` (`ComposerDock.tsx:350`).
- View popover: `clearOverride` in `packages/client/src/components/chat/ChatViewMenu.tsx:113-116` calls `setOpen(false)`. `setAsGlobal` calls `clearOverride` on success (`ChatViewMenu.tsx:137`).
- Composer root: `packages/client/src/components/chat/CommandInput.tsx:960` (`composer-root`) is `relative` (z auto) and later in the DOM than the dock. As the positioned ancestor of the unpositioned `composer-card` (`:1085`), it paints over the dock's tucked `pb-6` foot.

## Goals / Non-Goals

**Goals:** a seamless overlay-to-bar join; the overlay above chat floating controls; the View popover open after its footer actions.

**Non-Goals:** dock row content (branch truncation, chevron placement, Context title, bar summary text, Pin styling); peek timing and behaviour; View popover layout.

## Decisions

1. **One surface via shared-edge squaring (CSS only).** While `peeking`:
   - Root: `rounded-t-none border-t-transparent`, and drop the inset rim shadow. The overlay owns the top corners and the top edge.
   - Overlay: keep `-inset-x-px` (it sits exactly on the root's 1px side borders), `rounded-t-xl border border-b-0`, same `bg-[var(--bg-secondary)]`. Replace `shadow-lg` with an upward-only shadow `shadow-[0_-10px_24px_-12px_rgb(0_0_0/0.22)]`.
   - Seam: the existing bar-row `border-t border-[var(--border-subtle)]` stays as the single inner hairline.
   - Bar: no hover fill while peeking.

   Alternatives: (a) move the bar into the overlay. Rejected: it changes the focus, the Pin, and the `composer-dock-bar` structure that tests and the hover intent depend on. (b) Inverted-corner pseudo-elements. Unneeded because both parts have the same width.
2. **Raise only the overlay.** While `peeking`, the root omits `z-0`, so it no longer forms a stacking context. The overlay uses `z-popover` (40) instead of `z-raised`, which puts it above the chat's z-10 controls. Not peeking, the root keeps `z-0` (no behaviour change). The root is never raised, because a raised root would paint its `pb-6` foot over the composer card (observed in the mock).
   Alternative: hide the scroll button while peeking. Rejected: it couples ChatView to dock state.
3. **The View popover stays open.** Remove `setOpen(false)` from `clearOverride`. No success status text (per user). The existing `N changed` label clears naturally. Closing stays Escape, outside click, the trigger, or the phone scrim.

## Risks / Trade-offs

- [The overlay at `z-popover` vs dock menus] → lane menus render as descendants of the overlay (no portal in `ComposerDock`/lane files), so they share its stacking context and stay above its content. Manual check task.
- [The overlay at `z-popover` (40) now also covers the replay pill (`z-20`) and the prompt-desync affordance (`z-overlay` 30) while peeking] → accepted: a peek is a transient hover overlay over the transcript, and both return when it ends. The same holds for the scroll controls (`chat-transcript-virtualization` "Deterministic scroll-to-top affordance"): they stay visible whenever no peek is open.
- [Dropping `z-0` while peeking could change the paint order versus the composer card] → `composer-root` is positioned and later in the DOM, so it still paints over the root foot. Manual visual check task.
