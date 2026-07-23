## REMOVED Requirements

### Requirement: Directory card shows a folder watermark
**Reason**: The centered 3D folder watermark read as a real UI element competing with the slot-pill grid (its half-open flap poked above the pills at `.13` opacity), rather than as subtle texture. Replaced by shaping the card silhouette itself as a folder via a top-left tab nub (see ADDED requirement below).
**Migration**: Remove the `<img src="/assets/folder-3d.svg">` watermark layer from `SessionList.renderGroup` and delete the `public/assets/folder-3d.svg` asset. The card's `relative overflow-hidden` wrapper and `z-[1]` content layer are retained.

## ADDED Requirements

### Requirement: Directory card shows a folder-tab nub

The directory card SHALL render a small folder-tab nub peeking above its top-left corner so the card's silhouette reads as a folder. The nub SHALL be a static, non-interactive element (`aria-hidden`, `pointer-events: none`) rendered as a sibling behind the bordered card such that the card paints over the nub's lower edge and only its top peeks above the card. The nub SHALL use theme tokens (card background + subtle border) so it remains legible-but-subtle across all supported themes, and SHALL NOT intercept clicks, change the card's content layout, or add per-frame paint cost.

#### Scenario: Nub is non-interactive and behind the card
- **WHEN** the user clicks anywhere over the region occupied by the nub
- **THEN** the click SHALL reach the underlying card content, header, or slot pill, never the nub
- **AND** the nub SHALL render behind the bordered card (the card's opaque surface hides the nub's lower edge, leaving only the top visible as a tab)

#### Scenario: Nub does not shift the card content
- **WHEN** the directory card is rendered with the folder-tab nub
- **THEN** the header, git row, and slot-pill grid SHALL keep their existing layout, with the nub occupying only reserved space above the card's top edge

#### Scenario: Nub adapts across themes
- **WHEN** the active theme changes
- **THEN** the nub's background and border SHALL follow the same theme tokens as the card so it stays legible-but-subtle in every theme
