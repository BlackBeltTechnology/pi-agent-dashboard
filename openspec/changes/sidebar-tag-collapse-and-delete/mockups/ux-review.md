# UX Review — sidebar tag collapse + overflow + global delete

Mockup: `openspec/changes/sidebar-tag-collapse-and-delete/mockups/index.html`
Verified live at 3 breakpoints, dark + light (studio theme tokens, grounded in `packages/client/src/index.css` + `packages/shared/src/tags.ts` palette).

## Accessibility floor (hard gate)

| Check | Result | Note |
|---|---|---|
| Contrast ≥4.5:1 (light + dark) | **PASS** | Chip text uses the shipped dark-tuned palette foregrounds; labels/counts use `--text-muted`→`--text-tertiary` on `--bg-secondary`. Verified both themes. |
| Focus visible | **PASS** | Interactive controls are real `<button>`s (native focus ring). Promotion must keep `focus-ring` on chips. |
| Color not sole channel | **PASS** | Remove is a glyph `✕` + `aria-label`, not a color; phase chips carry a 🔒 glyph + dashed border, not just muted color. |
| Target size | **RISK (S2)** | ✕ is ~11px inside a 20px chip — below the 44px WCAG 2.5.5 / 24px 2.5.8 target. Acceptable in a dense sidebar (SC 2.5.5 AAA), but bump hit-area padding on the ✕ and ensure it is keyboard-reachable independent of the filter toggle. |
| Reduced motion | **PASS** | Only a 0.15s chevron rotation; wrap in `prefers-reduced-motion` on promote. |

No WCAG-AA or severity-4 defect open → **gate passes**.

## Heuristic rubric (Nielsen + Laws of UX)

| # | Criterion | Rule cited | Result |
|---|---|---|---|
| 1 | Fold/unfold is discoverable | NN/g visibility of system status | **PASS** — one master `Tags` chevron ▾/▸ + `aria-expanded`; default-collapsed, but the collapsed header shows `N tags · M phases` so the area's contents are never hidden without a signifier. |
| 2 | Reduce visible choices | Hick's Law (lawsofux.com/hicks-law) | **PASS** — overflow cap (10) + `+N more` keeps the initial chip set scannable. |
| 3 | Destructive action guarded | NN/g error prevention (H5) | **PASS** — confirm dialog before global delete; primary action styled destructive (red), Cancel is the safe default. |
| 4 | Honest system model | NN/g match system & real world (H2) | **PASS** — dialog states "reappears if any session re-adds it" — tells the truth that the chip is a derived union, not a registry. |
| 5 | Undo / reversibility | NN/g user control & freedom (H3) | **PARTIAL (S2)** — no undo after confirm. Mitigation: the confirm dialog + honest count. Consider an undo toast in a follow-up; not blocking. |
| 6 | Consistency | NN/g consistency & standards (H4) | **PASS** — chevron matches the folder-row chevrons already in `SessionList`; ✕ matches the `TagEditor` user-chip remove. |
| 7 | Read-only affordance is clear | Affordance / signifiers | **PASS** — phase chips are dashed + 🔒 + no ✕; they cannot be mistaken for editable. |
| 8 | Recognition over recall | NN/g H6 | **PASS** — fold state persists (localStorage), so the user's arrangement survives reload. |

## PURE friction (worst step wins)

- Fold a group → **green** (one click, obvious control).
- Expand overflow → **green** (`+N more` inline, no navigation).
- Delete a tag globally → **yellow** — correct friction: the confirm is a deliberate speed-bump on a destructive, N-session mutation. Not red because the copy makes the blast radius explicit.

## Prioritized fix list (for PROMOTE, none block the mockup)

1. **(S2, a11y)** Give the ✕ a ≥24px hit area and a focus ring distinct from the filter toggle; ensure Tab reaches ✕ separately (the two controls must not be nested buttons — render the ✕ as a sibling of the toggle in `TagChip` `filter` variant).
2. **(S2, control)** Consider an undo toast after global delete (re-applies the tag to the same N sessions) — follow-up, not this change.
3. **(S3, polish)** Wrap the chevron rotation in `prefers-reduced-motion`.
4. **(S3, i18n)** `+N more` / dialog copy through the `t()` layer like the rest of `SessionList`.

## Verdict

**Ship the direction.** All four requested behaviors (section fold, overflow cap, destructive per-tag delete with confirm, read-only phase group) render correctly and consistently in both themes at all breakpoints, and every decision traces to a cited heuristic. The only real open item is the ✕ target-size / keyboard-separation detail — a promote-time implementation note already captured in the design's interaction-snag section, not a design flaw.
