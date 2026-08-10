## 1. Remove the folder watermark

- [x] 1.1 Delete the watermark layer (`<div aria-hidden>` + `<img src="/assets/folder-3d.svg">`) from `SessionList.renderGroup`.
- [x] 1.2 Delete the orphaned asset `public/assets/folder-3d.svg` (only reference was the removed layer).
- [x] 1.3 Remove the `folder-3d.svg` row from `public/AGENTS.md`.

## 2. Add the folder-tab nub

- [x] 2.1 Wrap the bordered card in a `relative pt-[9px]` container inside `renderGroup` so ~9px of space is reserved above the card.
- [x] 2.2 Add a non-interactive nub: `aria-hidden`, `pointer-events-none`, absolutely positioned `top-0 left-3.5 w-[78px] h-3`, `bg-[var(--bg-primary)] border border-[var(--border-subtle)] border-b-0 rounded-t-lg`. It sits behind the card (which paints on top, hiding the nub's lower edge) so only the top peeks above the card as a folder tab.
- [x] 2.3 Keep the card's `overflow-hidden`, header, git row, slot-pill grid, and detached Create tray unchanged.

## 3. Verify

- [x] 3.1 `npm run build` clean; server restarted; nub renders above the top-left corner of the directory card in the live dashboard (light + dark themes via theme tokens).
- [x] 3.2 `SessionList.test.tsx` — 32/32 pass (nub is decorative, adds no queryable role/testid).
