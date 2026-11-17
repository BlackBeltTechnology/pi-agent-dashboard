## ADDED Requirements

### Requirement: Automation overlay surfaces scroll their own overflow

The Automations board (`/folder/:encodedCwd/automations`) and the run monitor (`/folder/:encodedCwd/automations/run/:sid`) SHALL each fill their shell-overlay slot (`flex-1 min-h-0`) and be their own single vertical scroll container. All of their content SHALL be reachable when it is taller than the host, without relying on the host to scroll. This conforms to `shell-overlay-route` "Route-backed overlay content SHALL be reachable".

#### Scenario: Long definitions list is reachable on a 13-inch desktop

- **WHEN** a folder has enough automation definitions that the board content is taller than the desktop plugin overlay (viewport 1440x900)
- **THEN** the board root is a vertical scroller (`overflow-y: auto`) whose height is bounded by the overlay
- **AND** scrolling it to the end brings the last definition card fully inside the overlay panel

#### Scenario: Long definitions list is reachable on mobile

- **WHEN** the same folder's Automations board opens at a mobile viewport
- **THEN** the board scrolls within the detail panel and its last definition card can be reached

#### Scenario: Exactly one vertical scroller

- **WHEN** the board shows tall content
- **THEN** the panel contains exactly one overflowing vertical scroller (the board root)

#### Scenario: Short list does not produce a scrollbar

- **WHEN** a folder has a single automation definition
- **THEN** the board content fits, and the board root does not overflow (no scrollbar is shown)

#### Scenario: Run monitor scrolls its own overflow

- **WHEN** the run monitor shows a findings block taller than its host
- **THEN** the run monitor root is a vertical scroller bounded by the host, and the end of the findings block can be reached

### Requirement: Automation overlay Back stays visible while scrolling

The header row that holds the Back control on the Automations board and on the run monitor SHALL stay visible while the content scrolls, because Back is the dismiss affordance of the flush plugin overlay.

#### Scenario: Back stays reachable while scrolled

- **WHEN** the board (or run monitor) has been scrolled to the end
- **THEN** its Back control (`automation-board-back` / `automation-run-monitor-back`) is still inside the visible panel area and can be activated without scrolling back up

### Requirement: Automation overlay roots do not scroll horizontally

Neither the board root nor the run monitor root SHALL scroll horizontally. Long names truncate. Wide markdown in the run monitor's findings SHALL scroll horizontally inside its own wrapper.

#### Scenario: Long folder or automation name does not widen the board

- **WHEN** the board shows tall content and a long folder name or automation name
- **THEN** the board root's `scrollWidth` does not exceed its `clientWidth`

#### Scenario: Wide findings markdown does not scroll the run monitor root

- **WHEN** the findings block contains a markdown table or code block wider than the panel
- **THEN** the run monitor root's `scrollWidth` does not exceed its `clientWidth`
- **AND** the wide content can be reached by scrolling horizontally inside the findings wrapper
