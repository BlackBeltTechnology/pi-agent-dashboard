## ADDED Requirements

### Requirement: Server chip label is capped and the in-column tray aligns to the dock inset

The server chip's label SHALL be capped to at most 32ch and truncated with an ellipsis, with the full title and address available through the chip's tooltip and accessible name. The address SHALL render as secondary text in the form `127.0.0.1:<port><path>`. In the in-column slot the tray SHALL align to the slot's left edge (the dock's `mx-5` inset); the fixed no-composer fallback SHALL stay bottom-right.

#### Scenario: Long page title is capped
- **GIVEN** a server chip titled "Saját jóváhagyó csoportok — A + C — a very long page title" on port 57783
- **WHEN** the chip renders in the slot
- **THEN** the label text SHALL be truncated at no more than 32ch
- **AND** the address `127.0.0.1:57783` SHALL remain fully visible
- **AND** the full title SHALL be available in the chip's tooltip and accessible name

#### Scenario: Chip aligns to the dock inset
- **GIVEN** a server chip in the in-column slot above the dock
- **THEN** the chip's left edge SHALL equal the slot's left edge (the dock's left inset)
- **AND** the chip SHALL NOT be right-aligned

#### Scenario: Fallback overlay stays bottom-right
- **GIVEN** a server chip with no live composer slot
- **THEN** the chip SHALL render in the fixed bottom-right safe-area overlay
