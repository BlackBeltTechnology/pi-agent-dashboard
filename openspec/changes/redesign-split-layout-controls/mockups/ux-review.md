# UX Review — session holder + editor/chat split layout

Mockup: `mockups/split-layout-redesign/index.html` (served live; dark + light).
Grounded in real sources: `ResizableSidebar.tsx`, `SessionList/SessionCard`,
`SplitWorkspace.tsx`, `SplitDivider.tsx`, `LayoutModeSwitch.tsx`, tokens from
`packages/client/src/index.css`.

## Problems in the shipped layout

| # | Problem | Root cause (file) |
|---|---------|-------------------|
| 1 | Collapse chevrons tiny, only tint on hover, no resting affordance | `SplitDivider.tsx` — `size={0.5}` glyphs, `text-tertiary`, no label |
| 2 | Rotated CHAT/EDITOR captions from the mockup are gone | never built; only a cryptic chevron shipped |
| 3 | Chevron cluster **overlaps a narrow chat pane** when maximized | `SplitDivider.tsx` — cluster is `absolute left-1/2 -translate-x-1/2` over a 6px bar → bleeds into both panes |
| 4 | Two redundant collapse controls | header `LayoutModeSwitch` + divider chevrons do the same job |
| 5 | Two resize seams speak different visual languages | rail `w-1 hover:bg-blue-500/30` vs divider `w-1.5 hover:bg-blue-500/40` |

## The redesign (direction A, confirmed with user)

- **One explicit control**: the header `Chat│Split│Editor` switch stays primary (dedup answered *yes*).
- **Rotated fold tabs, hover-reveal**: each pane owns a vertical `CHAT ‹` / `EDITOR ›` tab **anchored to its own inner edge** (`right:0` of chat / `left:0` of editor), revealed on workspace hover/focus. Self-labeling, big target, and **structurally cannot overlap** — it lives inside the pane, never floats over the seam (fixes #3).
- **Unified seam language**: rail edge and split divider share one `.seam` (1px hairline → 2px accent on hover, grip dots). The session holder now reads as part of the same resize system (fixes #5).
- **Peeks reuse the tab language**: `closed`→`EDITOR` peek right, `full`→`CHAT` peek left — same rotated vertical tab, so recover and collapse are one visual idiom.

## Scoring rubric (frontend-mockup-loop, both themes)

| Criterion | Verdict | Note / cited rule |
|-----------|---------|-------------------|
| Contrast (WCAG AA) dark+light | **PASS** | body/secondary text ≥7:1 dark, ≥9:1 light; tokens are shipped theme values. WCAG 1.4.3 |
| Hierarchy — one focal point | **PASS** | selected card blue rim + active mode segment; Gestalt figure/ground, Von Restorff |
| Spacing rhythm from scale | **PASS** | 8px grid, token radii (12/8px); not eyeballed |
| Token fidelity | **PASS** | every color = `--bg/--text/--border` var; no raw hex except decorative logo gradient |
| Anti-slop | **PASS** | system-font stack, no purple hero/Inter/centered marketing; product chrome |
| Discoverability of collapse | **PASS** | resting affordance via hover-reveal tab + always-present header switch; Nielsen H6 recognition-over-recall |
| Recovery from collapse | **PASS** | rotated peek restores split; Nielsen H3 user control |
| Console clean | **PASS** | no errors (static + minimal JS) |
| Responsive < 768px | **DEFERRED** | mockup is desktop-tier; real split stacks vertically on mobile (`SplitWorkspace` orientation `v`). Tabs must rotate to top/bottom edges there — follow-up |
| Touch targets ≥44px | **PARTIAL** | fold tab ~28px wide × ~64px tall — meets height, add horizontal padding on touch tiers (Fitts's Law / WCAG 2.5.5) |

**Score: 8 PASS / 1 partial / 1 deferred.** No WCAG-AA or severity-4 defect open → passes the hard accessibility gate.

## Prioritized follow-ups (by Nielsen severity)

1. **[sev 2] Mobile orientation** — when `orientation="v"` (stacked), fold tabs and seam must move to horizontal top/bottom edges; the rotated label rotates 90° the other way.
2. **[sev 2] Touch target width** — pad fold tab to ≥44px hit area on tablet/mobile tiers.
3. **[sev 1] Motion** — respect `prefers-reduced-motion` for the tab fade + card lift.
4. **[sev 1] Keyboard** — fold tabs are `tabindex`+Enter/Space here; on promote, wire them into the existing roving-tabindex system and add `aria-label`.

## Promote notes (when it leaves explore)

- Map 1:1: `.seam`→shared resize component used by both `ResizableSidebar` and `SplitDivider`; `.foldtab`→pane-owned button rendered inside each pane wrapper in `SplitWorkspace.tsx` (NOT centered on the divider).
- Keep `LayoutModeSwitch` as the labeled primary control; the divider loses its `absolute`-centered chevron cluster entirely.
- Verify in an **isolated env** (non-8000 ports) per `frontend-mockup-loop-dashboard` — never against live `:8000`.
