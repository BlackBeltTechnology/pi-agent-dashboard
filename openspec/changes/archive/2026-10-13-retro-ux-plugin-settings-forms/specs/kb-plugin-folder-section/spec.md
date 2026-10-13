## ADDED Requirements

### Requirement: KB pill state words and badges use tokens
The KB folder pill SHALL render the `denied`, `pinning`, `missing`, `indexing`, `no-sources` and `not-indexed` state words in `--text-secondary` with an icon (spinner for indexing and pinning, info otherwise), never in a Tailwind palette class. The `error` state SHALL render "index failed" as a severity-error pill. The stale marker SHALL render as a severity-warning pill whose text keeps the form `⚠ N stale` and whose `data-testid` stays `folder-kb-stale`, at 11 px. Count units ("chunks", "N files") SHALL be 11 px in `--text-secondary`. The card-placement KB control SHALL stay a compact icon-only control with secondary-button colours (`--bg-tertiary`, `--border-secondary`, `--text-primary`) and no palette classes, sized per the `ui-contract.md` aligned-action-surface rule for icon-only buttons (44 × 44 px below `sm`, 32 × 32 px from `sm` up), with an accessible name matching its action. The only palette classes allowed in the pill are SlotPill's own accent glyph classes (shared; follow-up). The pill SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in every state: loading, populated, stale, indexing, pinning, no-sources, not-indexed, denied, missing, and error.

#### Scenario: No palette class in state words or the card control
- **WHEN** the pill renders `no-sources`, `not-indexed`, `indexing`, `denied`, `missing` and `error`, in the card placement
- **THEN** no element outside SlotPill's glyph chip carries a Tailwind palette class

#### Scenario: Stale marker keeps its text
- **WHEN** KB stats report `staleCount: 3`
- **THEN** `folder-kb-stale` reads `⚠ 3 stale` inside a severity-warning pill

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty
