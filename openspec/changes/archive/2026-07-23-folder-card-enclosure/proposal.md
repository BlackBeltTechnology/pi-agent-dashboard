## Why

The directory card reads as a folder header (nub tab, slot pills), but its Create tray and session cards float **below** it as detached siblings — so the folder metaphor stops at the card border and nothing looks "contained." Separately, a **top-level (non-workspace) folder** has no enclosing group container, and in warm/low-contrast themes (e.g. Rosé Pine Dawn, where `--bg-primary`, `--bg-secondary`, `--bg-tertiary` are near-identical creams) its `--bg-primary` card + 6% border blends into the page — the folder boundary disappears. Both were validated in mockups under `mockups/folder-enclosed-sessions/`.

## What Changes

**A. Enclose the folder's contents (reverses the detached Create tray)**
- The directory card header (git row, slot pills) and a new **folder body** are wrapped in ONE folder border: header is `rounded-t` + `border-b-0`, the body is `border-t-0` + `rounded-b`, sharing the `--bg-primary` surface so the whole folder reads as one continuous sheet.
- A soft **fold-shadow seam** (inset shadow at the top of the body) marks where the header meets the body, like an opened folder flap.
- The **Create tray**, the **session list** (active + placeholders + spawn-error banners), and the **"Show N ended" row** all move INSIDE the folder body.
- Two labeled separators structure the body: the existing **CREATE** divider and a new **SESSIONS** divider (same style).
- Session cards keep their existing `--bg-tertiary` fill, status spine, and selection ring — so they read as distinct "files" inside the folder. **No change to SessionCard.**

**B. Distinguish top-level (root) folders**
- A folder that is NOT inside a workspace gets a subtle **accent-tinted surface** — `color-mix(in srgb, var(--accent-blue) ~5%, var(--bg-primary))` plus an accent-tinted border — so its boundary is legible across every theme (the tint is derived from the theme's own accent, not a hardcoded color). Workspace-grouped folders are unchanged (their group container already separates them).

No behavioral/protocol changes to spawn, sessions, DnD, or collapse. Copy strings and `data-testid`s preserved.

## Capabilities

### Modified Capabilities
- `directory-card-layout`: REMOVE the "detached Create tray" requirement; ADD a requirement that the card **encloses** its Create tray + sessions (+ ended row) in a folder body with CREATE/SESSIONS separators and a fold-shadow seam; ADD a requirement that **root (non-workspace) folders** render with an accent-tinted surface.

## Impact

- **Client component**: `packages/client/src/components/session/SessionList.tsx` (`renderGroup`) — reshape the card wrapper, add the `folderbody`, move Create tray + session render block + ended row inside, add the SESSIONS separator, apply the root tint when `!inWorkspace`.
- **SessionCard**: untouched.
- **Tokens**: reuse `--bg-primary`, `--border-subtle`, `--shadow-card`, `--accent-blue`; the root tint uses `color-mix` (already used elsewhere in the client). No new tokens, no raw hex.
- **Tests**: `SessionList.test.tsx` must stay green; add coverage that the Create tray + "Show N ended" row render inside the folder body, and that a non-workspace folder gets the tinted surface while a workspace folder does not.
- **Care points**: collapsed state (body hidden → enclosure collapses to header), DnD session reordering inside the body, spawn-error banners + placeholder cards inside the body, workspace-folder nesting (no root tint), and the folder-tab nub (from change `folder-card-tab-nub`) still peeking above the header.
- **No server / protocol / persistence impact.**

## Discipline Skills

- `review-code` — non-trivial restructure of a high-traffic component; review the diff before commit.
- `performance-optimization` — the enclosure + fold-shadow + root tint render across every folder in the sidebar; verify no added per-frame paint cost vs the card-pulse budget.
- `doubt-driven-review` — reverses a shipped spec requirement (detached tray); sanity-check the enclosure decision before it stands.
