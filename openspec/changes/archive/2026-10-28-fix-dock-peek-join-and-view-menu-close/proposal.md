# Proposal

## Why

Two client UI defects, reported with screenshots.
1. Hovering the collapsed composer dock peeks a lane overlay that doesn't join the bar. Two rounded, bordered boxes stack: the seam is doubled, the corners notch, the overlay's shadow falls on the bar, and the bar's hover fill stops at Pin. The chat's scroll-to-bottom button also paints through the overlay.
2. In the per-session `⚙ View` popover, Reset and Set as global close the popover. The user loses their place and gets no visible result.

## What Changes

- The peek overlay and the collapsed bar render as ONE surface. Only the overlay's outer top corners are rounded. The dock root's top edge goes square and borderless while peeking. The side edges line up. One inner hairline marks the seam. The shadow points up only. The bar shows no hover fill while peeking.
- The peek overlay stacks above the chat's floating controls (scroll-to-bottom / scroll-to-top). Only the overlay is raised; the dock root keeps painting under the composer card.
- The `⚙ View` popover stays open after Reset and after a successful Set as global. No success text is added. The existing `N changed` count clears, and both actions disable once nothing differs.
- Mockup: interactive before/after served from `/tmp/mockups/dock-and-view/` during explore (not committed).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `composer-dock`: peek overlay renders joined to the bar as one surface, above chat floating controls.
- `chat-display-preferences`: View popover footer actions keep the popover open.

## Impact

- `packages/client/src/components/chat/ComposerDock.tsx`: peek classes on the root, the region and the `SummaryBar`.
- `packages/client/src/components/chat/ChatViewMenu.tsx`: `clearOverride` no longer closes the popover.
- Tests: `packages/client/src/components/chat/__tests__/ComposerDock.peek.test.tsx`, `packages/client/src/components/__tests__/ChatViewMenu.footer.test.tsx`.
- No server, protocol or API change.

## Discipline Skills

None apply. This is a client-only styling and state fix, with no auth, untrusted input, latency budget, new endpoint or irreversible step. `review-code` runs inline before commit, per the standard checkpoint.
