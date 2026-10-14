## Context

Capsule legend today, `packages/dashboard-plugin-runtime/src/SlotPill.tsx:120` and `packages/client/src/components/session/SessionSubcard.tsx:34`:

```
absolute -top-1.5 … px-1.5 py-px border text-[12px] font-semibold uppercase tracking-wider leading-none
```

A third, hand-mirrored copy of the SlotPill chrome lives in `packages/client/src/components/openspec/FolderOpenSpecSection.tsx:224` (the `cli-failed` inert pill — SlotPill's unconditional `role="button"` root cannot be reused inert, comment at :218-220). It still carries `text-[9px]`.

Geometry (estimates; the new probe measures them): legend height ≈ 12 + 2 (`py-px`) + 2 (border) = 16 px. At `-top-1.5` (6 px) it spans y = −6 … +10 inside the panel. SlotPill content starts at `pt-2.5` (10 px) — the legend sits flush on the content row; `SessionSubcard` (`py-1.5`, 6 px) overlaps its children by ~4 px. Estimated width of "KNOWLEDGE BASE" at 12 px uppercase + `tracking-wider` ≈ 125 px vs ≈ 150 px per sidebar pill (`packages/client/src/components/session/SessionList.tsx:2256`, `grid-cols-1 sm:grid-cols-2`).

KB count line, `packages/kb-plugin/src/client/FolderKbSection.tsx` `KbCount` (:186-220): count + `UNIT` span + stale `PILL` (:173, `whitespace-nowrap`, no `shrink-0`). Wrappers: `folder-kb-count` (:314, `flex min-w-0`, no clip) inside SlotPill's content span (`SlotPill.tsx:126`, `min-w-0 flex-1`, no clip). Flex children keep their min-content width → the stale pill paints past the pill border. Card placement (`worktree-card-section` slot, `packages/client/src/generated/plugin-registry.tsx:395`) shares the row with the 32/44 px reindex control (:319-338).

Type rules: `ui-contract.md:147` floor — < 11 px only for non-essential text. `ui-contract.md:150-153` aligned action surfaces (session card included) — labels ≥ 12 px, dense metadata may stay 11 px. `tests/e2e/helpers/computed-contrast.ts:114-121` `sizeFailures` — fails < 11 px anywhere, < 12 px only inside `button|label|a`.

## Goals / Non-Goals

**Goals:** legends read as labels, not headings; nothing paints outside a KB slot pill; an automated probe catches that overflow from now on.
**Non-Goals:** SlotPill layout redesign; content changes to other slot sections; the folder-menu MAINTENANCE item (keeps "N stale"); overflow probes for non-KB pills.

## Decisions

**D1 — Legend 11 px uppercase, one shared class constant (user choice).** `packages/dashboard-plugin-runtime/src/SlotPill.tsx` exports `SLOT_PILL_LEGEND` (surface-independent legend tokens: `absolute -top-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-12px)] truncate px-1.5 py-px rounded-full border border-[var(--border-subtle)] text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] leading-none`), re-exported from the barrel `packages/dashboard-plugin-runtime/src/index.ts` (today `:91-92` exports only `SlotPill` + types). `SlotPill` and the inert mirror in `packages/client/src/components/openspec/FolderOpenSpecSection.tsx:224` compose it with their fill. `SessionSubcard.tsx:34` cannot take it verbatim (`inline-flex` host for its legend menu, no `truncate`), so it carries the same size/weight/tracking/overhang/colour tokens and a unit parity test pins them against `SLOT_PILL_LEGEND`. 11 px is the `meta` step and the hard floor (`ui-contract.md:147`).
`ui-contract.md`: the capsule-legend row moves to 11 px; the aligned-action-surface paragraph (`:150-153`) gains ONE bounded exception — capsule legends of `SlotPill` / `SessionSubcard` / the SlotPill mirror render at 11 px uppercase.

**D2 — Overhang `-top-2`, ≈ 3 px clearance inside and between panels.** Capsule height ≈ 15 px; `-top-2` (8 px above the padding edge) puts its top ≈ 7 px above the outer border and its bottom ≈ 7 px below the padding edge. Inside: SlotPill keeps `pt-2.5` (10 px → ≈ 3 px); `SessionSubcard` `py-1.5 → pt-2.5 pb-1.5` (≈ 3 px). Between: `SessionSubcard` `mt-1.5 → mt-2.5` and the session-card KB slot wrapper (`packages/client/src/components/session/SessionCard.tsx:1490`, `worktree-card-section-gap`) `mt-1.5 → mt-2.5` (10 px → ≈ 3 px). The sidebar grid (`gap-y-3`, 12 px) already clears. Cost: each desktop subcard grows ≈ 8 px; accepted.

**D3 — Compact MDI stale marker; truncation that never hides the number.**
- Marker: `<span data-testid="folder-kb-stale" title="{labelStale}" class="{PILL} shrink-0 gap-0.5">` containing `<Icon path={mdiAlertOutline} aria-hidden/>`, `<span aria-hidden="true">N</span>` and `<span class="sr-only">{labelStale}</span>`. MDI instead of the `⚠` text glyph satisfies `mdi-icon-system` (no Unicode symbol as an icon inside the pill's `role="button"`). `labelStale` is the existing localized key — no new keys. The testable accessible name is the SlotPill root's (`folder-kb-open-settings`, name from content): contains "3 stale".
- Number: the chunk count span is `shrink-0 tabular-nums` — it is never truncated. Only the `chunks` unit span is `min-w-0 truncate` (it may ellipsize to nothing). Same in the indexing branch: the files number `shrink-0`, its unit `min-w-0 truncate`.
- Text runs: `StateWord` and the error pill wrap their text in an inner `<span class="min-w-0 truncate">` (a bare text node in a flex container cannot ellipsize) and get `min-w-0`.
- Chain: the sidebar `folder-kb-section` root gets `min-w-0` (it is the grid item; `SidebarFolderSectionSlot` renders a bare fragment, `packages/dashboard-plugin-runtime/src/slot-consumers.tsx:158-165`); `folder-kb-count` keeps `flex min-w-0` with NO `overflow-hidden`, so nothing between the marker and the pill root can clip it. `SlotPill.tsx:126` content span is unchanged.

**D4 — Overflow probe + direct marker checks (one signature, exact algorithm).** In `tests/e2e/helpers/computed-contrast.ts`:
- `TextMeasure` gains `srOnly: boolean` (`e.closest(".sr-only") !== null` in `measureText`). `contrastFailures` and `sizeFailures` both skip `srOnly` measures — screen-reader-only text has no visual footprint, so neither floor applies; `measured` still counts them.
- Pure `overflowOf(root: Rect, items: OverflowItem[]): string[]` where `OverflowItem = { where: string; rect: Rect; clips: Rect[]; topExempt: boolean }`. Each item's effective box = `rect` ∩ every rect in `clips`; an empty intersection is skipped (fully clipped). It fails per edge where the box extends past `root` by > 0.5 px (sub-pixel rounding of `getBoundingClientRect` under `-translate-x-1/2`); `topExempt` items are ignored on the TOP edge only — their left/right/bottom still fail. Entry format: `` `${where} ${edge} +${px.toFixed(1)}px` ``.
- In-page `overflowFailures(root: Locator, topExempt?: string): Promise<string[]>` collects items: every descendant of `root` that is visible (same predicate as `measureText`: `offsetParent !== null`, opacity ≠ 0, visibility ≠ hidden — no text requirement) and not `.sr-only`; `rect` = `getBoundingClientRect()` (transform-inclusive); `clips` = `getBoundingClientRect()` of every ancestor strictly between it and `root` whose computed `overflow-x`/`overflow-y` ≠ `visible`; `topExempt` = `el.matches(selector)` on the element itself (not its subtree). Root = the border box of `root`; the root's own overflow is not considered. Clipping ancestors are descendants too, so a clipper that itself overflows fails. No `position:fixed` content exists inside slot pills; it is not special-cased.
- The capsule legend gets a stable hook `data-slot-pill-legend` (in `SLOT_PILL_LEGEND`'s element in `SlotPill` and the mirror); `overflowTopExempt = "[data-slot-pill-legend]"`.
- Direct marker checks (new spec, `stale` state only): export `contrastRatio(fg, bg)` (today `lum`/`ratio` are closures inside `measureText`, `computed-contrast.ts:64-75`); compare the computed `color` of the `aria-hidden` count span inside `folder-kb-stale` against the marker's own computed background (`--severity-warning-bg`) ≥ 4.5:1; assert the UNCLIPPED `folder-kb-stale` rect ⊂ root; the chunk-number span gets `data-testid="folder-kb-chunks"` and is asserted `scrollWidth <= clientWidth` and `textContent === (19397).toLocaleString("en-US")` (harness runs en-US).
- `ui-capture.ts`: `UiState` gains `overflowRoot?(page: Page): Locator` and `overflowTopExempt?: string`; per theme × width cell, after `open`, `captureCell` calls `overflowFailures` only when `overflowRoot` is set, else `overflow: []`. `CaptureResult` gains `overflow: string[]`.
- Callers: the five existing capture specs (`retro-ux-identity-connectivity`, `-chat-rendering`, `-credential-vault`, `-model-selector`, `-plugin-settings-forms`) each add one `...r.overflow` line to their `failures()` — they declare no `overflowRoot` except `kb-pill`, so their result is unchanged except for `retro-ux-plugin-settings-forms`, whose KB pill gains the overflow assertion.

**D5 — Both placements automated.** New `tests/e2e/fix-slot-pill-legend-overflow.spec.ts` (per-change capture spec pattern; evidence under this change's `mockups/after/`):
- Sidebar: re-uses `kbPillStates` from `tests/e2e/fixtures/retro-ux/kb-pill.ts`, which gains `overflowRoot = getByTestId("folder-kb-open-settings").first()` (the SlotPill root, not the wrapper that also holds the card control). The existing `stale` state already reports `chunks: 19397` (`kb-pill.ts:14,49`). `failures()` includes `overflow`. Asserts legend `bottom ≤` glyph-chip `top` (1 column at 375 px, 2 columns at 768/1440 px).
- Card: `beforeAll` creates a git worktree and spawns a session in it exactly as `tests/e2e/folder-collapse-worktree.spec.ts:83-97` does (`/api/git/worktree` → `/api/session/spawn` → `awaitWorktreeSessionId`); `/api/kb/stats` is stubbed (answers every cwd) for `populated` and `stale`; the probe root (768 and 1440 px only — below 768 px `useMobile` renders the mobile card, which has no KB slot) is that session card's `folder-kb-open-settings`. Also asserts adjacent `SessionSubcard` legends do not reach into the element above.
- E2E is opt-in (`npm run test:e2e`): the probe guards when it runs, not on every PR.

## Risks / Trade-offs

- Pinned tests change together: `SlotPill.test.tsx:97`, `SessionSubcard.test.tsx:20,70`, `FolderKbSection.test.tsx:184-189` (E11: pill and menu badge both contain "3 stale" → split: pill visible count + sr-only/title full form; menu badge full form) and `:772-777` (`textContent` changes → assert the visible count, the icon and the sr-only text separately).
- `sizeFailures` treats only `button|label|a` as interactive, so an 11 px legend inside SlotPill's `div[role=button]` is never held to 12 px by the probe; the `ui-contract.md` exception makes this explicit rather than accidental. Extending the probe to `[role=button]` is out of scope (it would also flag the 11 px units).
- `SessionSubcard` titles are i18n strings (`SessionCard.tsx:1451…1961`); its legend has no `truncate`/`max-w` (unchanged by this change), unlike SlotPill's. Accepted.
- Only the KB pill gets the overflow probe; other SlotPill users are a follow-up.
- Pre-existing, out of scope (follow-ups): `loading` renders "0 chunks"; the OpenSpec-click scenario in `directory-card-layout` describes READY only; GIT-subcard worktree pill still uses `text-[9px]`; `SubcardLegendMenu` trigger size inside the capsule.

## Migration / Rollback

Presentation-only. No data, protocol or API. Rollback = revert the commit.
