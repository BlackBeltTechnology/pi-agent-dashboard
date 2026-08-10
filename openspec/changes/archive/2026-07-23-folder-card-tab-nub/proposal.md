## Why

The directory card (`SessionList.renderGroup`) shipped with a faint **3D folder watermark** centered behind its content (change: redesign-directory-card). In practice the watermark's `188px` art, clipped to a hard diagonal at `.13` opacity, read as a real UI element competing with the 2×2 slot-pill grid rather than as subtle texture — its half-open flap poked above the pill grid. UX review (`mockups/folder-watermark-size/`, `mockups/folder-shaped-card/`) explored shrinking, re-anchoring, and removing it, and converged on a different way to signal "this card is a folder": shape the **card silhouette** as a folder instead of drawing an icon behind it.

## What Changes

- **Remove** the folder watermark (`<img src="/assets/folder-3d.svg">` layer) from `SessionList.renderGroup` and delete the now-orphaned `public/assets/folder-3d.svg` asset.
- **Add** a small, non-interactive **folder-tab nub** peeking above the directory card's top-left corner, so the card reads as a folder. The nub is a sibling rendered *behind* the bordered card (the card paints over its lower edge); the card keeps its existing header, git row, and slot-pill grid unchanged.
- No change to the card's content, the slot pills, the detached Create tray, collapse/expand behavior, navigation, or any `data-testid`.

This is presentation-only. No server, protocol, or persistence impact.

## Capabilities

### Modified Capabilities
- `directory-card-layout`: the **folder watermark** requirement is REMOVED and replaced by a **folder-tab nub** requirement (card silhouette reads as a folder via a top-left tab rather than a behind-content icon). The slot-pill grid and detached Create tray requirements are unchanged.

## Impact

- **Client component**: `packages/client/src/components/session/SessionList.tsx` (`renderGroup`) — remove watermark layer, wrap the card in a `relative pt-[9px]` container, add the `aria-hidden` `pointer-events-none` nub div.
- **Asset**: delete `public/assets/folder-3d.svg` (only referenced by the removed watermark).
- **Docs**: drop the `folder-3d.svg` row from `public/AGENTS.md`.
- **Tokens**: nub uses existing `--bg-primary` + `--border-subtle` theme tokens; adapts across all four themes. No new raw hex.
- **Tests**: existing `SessionList.test.tsx` (32 cases) must stay green; the nub is decorative (`aria-hidden`) so it adds no queryable role/testid.
- **No server / protocol / persistence impact.**

## Discipline Skills

- `review-code` — non-trivial visual change to a high-traffic component; review the diff before commit.
- `performance-optimization` — the nub renders once per directory card across the sidebar; verify it adds no measurable per-frame paint/compositing cost (it is a static, non-animated element, and it replaces a heavier SVG layer).
