## MODIFIED Requirements

### Requirement: KB pill state words and badges use tokens
The KB folder pill SHALL render the `denied`, `pinning`, `missing`, `indexing`, `no-sources` and `not-indexed` state words in `--text-secondary` with an icon (spinner for indexing and pinning, info otherwise), never in a Tailwind palette class. The `error` state SHALL render "index failed" as a severity-error pill. The stale marker SHALL render as a severity-warning pill at 11 px with `data-testid` `folder-kb-stale` that never shrinks: its visible form is the compact MDI `mdiAlertOutline` icon plus the count `N` (both hidden from assistive tech; no Unicode warning glyph), its accessible text is the localized full form `N stale` rendered as screen-reader-only text, and its `title` carries the same full form for hover. Under width pressure the unit words ("chunks", "files"), the state words and the error text SHALL truncate with an ellipsis and SHALL NOT wrap; the chunk and file NUMBERS SHALL never be truncated; no element between the marker and the SlotPill root SHALL clip the marker. Count units ("chunks", "N files") SHALL be 11 px in `--text-secondary`. The card-placement KB control SHALL stay a compact icon-only control with secondary-button colours (`--bg-tertiary`, `--border-secondary`, `--text-primary`) and no palette classes, sized per the `ui-contract.md` aligned-action-surface rule for icon-only buttons (44 × 44 px below `sm`, 32 × 32 px from `sm` up), with an accessible name matching its action. The only palette classes allowed in the pill are SlotPill's own accent glyph and root hover-border classes (shared; follow-up). The pill SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in every state: loading, populated, stale, indexing, pinning, no-sources, not-indexed, denied, missing, and error; in the sidebar placement (every state) and the desktop session-card placement (`populated`, `stale`, at 768 and 1440 px — the mobile card below 768 px renders no KB slot) it SHALL also pass the overflow probe, which fails when any visible descendant's (clipped) box extends past the SlotPill root's border box, with only the capsule legend exempt on the top edge.

#### Scenario: No palette class in state words or the card control
- **WHEN** the pill renders `no-sources`, `not-indexed`, `indexing`, `denied`, `missing` and `error`, in the card placement
- **THEN** no element outside SlotPill's glyph chip carries a Tailwind palette class

#### Scenario: Stale marker keeps its text
- **WHEN** KB stats report `staleCount: 3`
- **THEN** `folder-kb-stale` shows an `mdiAlertOutline` icon and `3` inside a severity-warning pill, contains no `⚠` character, and carries `shrink-0`
- **AND** its `title` reads `3 stale`
- **AND** the SlotPill root (`folder-kb-open-settings`) has an accessible name containing `3 stale`

#### Scenario: Stale marker stays inside the pill
- **WHEN** KB stats report `chunks: 19397` and `staleCount: 3` and the pill renders in the sidebar folder grid at 375, 768 and 1440 px
- **THEN** the unclipped `folder-kb-stale` box lies within the SlotPill root's border box
- **AND** the overflow failure list is empty
- **AND** the visible count `3` meets the contrast floor against the severity-warning background
- **AND** the chunk count reads `19,397` in full (not truncated)

#### Scenario: Stale marker stays inside the pill in the card placement
- **WHEN** a session in a git worktree whose KB reports `chunks: 19397` and `staleCount: 3` renders its desktop session card at 768 and 1440 px
- **THEN** the unclipped `folder-kb-stale` box lies within the SlotPill root's border box
- **AND** the chunk count reads `19,397` in full (not truncated)

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size, focus and overflow failure list is empty
