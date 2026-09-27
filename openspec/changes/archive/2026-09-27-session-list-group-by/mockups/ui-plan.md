# UI plan — session-list-group-by

Live mockup: `mockups/index.html` (serve: `serve_mockup{dir: openspec/changes/session-list-group-by/mockups}`).
Files: `index.html` · `mockup.css` · `app.js` · `tokens.css` (1:1 snapshot of `packages/client/src/index.css`).

## Grounding

| Source | Taken |
|---|---|
| `SessionList.tsx` L1571 / L1579 / L1793 / L1850 | folder tab-nub, header plate `rounded-t-[14px]`, body `rounded-b-[14px]`, rail `left-[7px] w-0.5 bg-[var(--rail-directory)]` |
| `SessionCard.tsx` L1012 | card `rounded-xl pl-1.5 pr-2 py-2`, rim + card shadow, connector tick `-left-[11px] top-[19px]`, status chip `w-4 h-4` |
| `session-status-visuals.ts` | `deriveStatusShape` shapes (filled / half / outline / ✕), `CAPSULE_SEGMENT_ORDER = needsYou, error, working, idle` |
| `index.css` | `--status-needs-you/working/idle/error`, `--bg-*`, `--text-*`, `--border-*`, `--rail-directory`, `--elevation-rim`, `--shadow-card` |

## Surfaces → tokens → states

### 1. Folder header (modified)
- Row 1 unchanged: chevron · name · count · status capsule · `⋯`.
- Row 2 (path line) gains the **mode chip** at the right: `[glyph] Status` / `[glyph] Location`; ` · default` suffix in `--text-muted` when the mode is inherited. Hidden when effective mode is `none`.
  - Tokens: `--bg-tertiary` fill, `--border-subtle` border, `--text-secondary` text, 10px, pill radius.
  - Click → opens the folder `⋯` menu (shortcut, same menu).
  - Why row 2: on row 1 it truncated the folder name to `pi-agent-da…` at 360 px (mockup finding F1).
- Folder collapsed + mode ≠ none: row 2 shows the chip only (no path), so a collapsed folder still says how it opens.

### 2. Folder `⋯` menu (modified)
- Top group “Group sessions by”, `role=menuitemradio` ×4: `Use default (<Mode>)`, `None — One list, newest first`, `Status — Needs you · Working · Idle`, `Location — Main checkout · Worktrees`.
- Selected radio = `--accent-blue`. Descriptions `--text-muted` 10px.
- Keyboard: opens with focus on the checked item; ↑/↓ cycle; Enter/Space select → menu closes, focus returns to `⋯`; Esc closes.
- Replaces the `Float blocked sessions to top` toggle.

### 3. Lane header (new)
- Anatomy, left → right: **glyph on the rail** (16 px chip, `--bg-tertiary`, glyph in lane color) · label (11px/600, `--text-secondary`) · sub (`· develop`, `--text-muted`) · [selected marker] · [collapsed rollup] · count pill · chevron (right).
- The glyph sits centred on the lane's rail segment (x = 8 px), so the rail hangs from it like a timeline (mockup finding F2).
- Lane rail segment: `color-mix(lane color 55%, transparent)`. Location lanes use neutral `--text-tertiary` — location is not a status, so it gets no status color.
- Height 26 px desktop; 44 px on `pointer: coarse` / ≤ 760 px.
- `<button aria-expanded aria-controls>`; the lane is a `<section aria-label>`.
- Lane text NEVER uses a status color (amber `#eab308` on white ≈ 1.9:1). Color lives only on the glyph + rail; shape + label carry the meaning (WCAG 1.4.1).

| Lane | Glyph (shape) | Color token |
|---|---|---|
| Needs you | filled circle | `--status-needs-you` |
| Failed | ✕ circle | `--status-error` |
| Working | half circle | `--status-working` |
| To review | outline + dot | `--status-unread` **(NEW)** |
| Idle | outline circle | `--status-idle` |
| Main checkout · `<branch>` | branch | `--text-tertiary` |
| Worktrees | stacked squares | `--text-tertiary` |

### 4. Lane collapsed
- Cards hidden (max-height anim 250 ms, same as folder).
- Status lanes: count only. The lane holds one status, so a status rollup would repeat the label (Nielsen #8).
- Location lanes: count + the mini status capsule (`needs / error / working / idle` with shape glyphs).
- Selected session inside: `--accent-blue` 6 px dot + sr-only “contains selected session”. The lane does not auto-expand.

### 5. Card in the hold window (new state)
- The card stays in Working with its **new** status already on the card (e.g. cyan “New reply”).
- A 2 px underline shrinks over 3 s in the **destination lane color** (`--dest`), then the card FLIPs to its new lane.
  - It announces where the card is going and when (Nielsen #1).
  - The first iteration used amber, which contradicted the cyan status (finding F3).
- Reduced motion: underline static at 50 %, the move is instant.

### 6. Card moves
- FLIP 220 ms `cubic-bezier(.2,.8,.2,1)`. Skipped during a drag and under `prefers-reduced-motion`.
- If the selected card moves: `aria-live=polite` announces “<name> moved to <lane>”, and the card is scrolled into view (`block: nearest`).

### 7. Drag
- Within a lane: normal reorder (slot-preserving merge).
- Over another lane:
  - lane gets a dashed `--status-error` outline, and `dropEffect=none` gives the no-drop cursor;
  - on release, a toast explains why:
    - Status: “Lanes follow session status — it moves on its own. Reorder within a lane.”
    - Location: “Lanes show where a session runs — it can’t be dragged between them.”
- Ended bucket → any lane: drag-to-resume keeps the drop slot, toast “Resumed … kept where you dropped it.”

### 8. Settings → Sidebar → Default grouping (new)
- 3-segment `role=radiogroup` (None / Status / Location); ←/→ change the value.
- Hint: “Applies to every folder that has no grouping of its own. Change a single folder from its ⋯ menu.”

### 9. Unchanged behaviour
- Search and tag filters flatten the lanes: plain list, stored order, ended matches inline.
- ≤ 1 non-empty lane renders the plain list; the mode chip stays visible.

## Rubric (final pass, dark + light, 375 / 1440)

| Check | Result | Note |
|---|---|---|
| Contrast AA (new UI) | PASS | Lane text uses `--text-secondary`/`--text-muted`, never status color. |
| Contrast AA (existing debt) | NOTE | Light theme amber activity text (`read`, `Thinking…`) and glyphs fail 1.4.3 / 1.4.11. Pre-existing in `SessionCard.tsx`, out of scope — file a follow-up. |
| Color not sole channel (1.4.1) | PASS | Shape + label per lane. |
| Responsive | PASS | No horizontal overflow at 375. The review-panel URL overflow was fixed with `overflow-wrap:anywhere` + `minmax(0,1fr)`. |
| Touch targets | PASS | 44 px on coarse pointers / ≤ 760 px. The chip keeps an 18 px visual with a 44 px hit area. |
| Keyboard | PASS | Menu radio nav, lane toggles, segmented default, cards Enter/Space. |
| Reduced motion (2.3.3) | PASS | FLIP + hold animation disabled. |
| Status messages (4.1.3) | PASS | `aria-live` on selected-card lane change. |
| Token fidelity | PASS | Every value is a snapshot var. The only new one is `--status-unread`. |
| Console | PASS | No errors or warnings (Playwright). |

## Findings fixed during the loop
- **F1 (sev 2):** the mode chip truncated the folder name. Moved the chip to the path row.
- **F2 (sev 1):** the lane glyph was off the rail. Glyph now sits on the rail; chevron moved to the right.
- **F3 (sev 2):** the hold underline was amber while the card showed cyan. Underline now uses the destination color.
- **F4 (sev 3):** the page overflowed horizontally at 375 px. Grid `minmax(0,1fr)` + wrapping.
- **F5 (sev 2):** targets were 26–28 px on touch. Added a 44 px coarse-pointer block (placed last so it wins the cascade).

## Spec deltas surfaced by the mockup (need folding into `specs/`)
1. **Failed lane.** `deriveStatusShape` + the capsule already treat `error` as its own bucket, ranked after needs-you. Add lane `error` (“Failed”) between `needs-you` and `working`. Classifier = `deriveStatusShape`, plus:
   - an `unread` overlay on idle → `review`;
   - `notice` → `review`.
2. **Mode chip on the folder header** (path row, `· default` suffix when inherited). Clicking it opens the folder menu.
3. **Hold visual.** A held card shows its new status plus a destination-colored countdown underline.
4. **Collapsed lane rollup.** Status lanes show the count only; location lanes show count + status capsule.
5. **Cross-lane drop feedback.** Deny outline + no-drop cursor + explanatory toast (the current spec only says “rejected”).
6. **Announcement.** `aria-live` message when the selected session changes lane.
7. **New token.** `--status-unread` (dark `#22d3ee`, light `#0891b2`) in the theme layer. Replaces the hardcoded cyan in `.card-stripes-unread`.
