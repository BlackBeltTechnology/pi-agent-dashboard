## ADDED Requirements

### Requirement: Server chip label is capped and the in-column tray aligns to the dock inset

The server chip's label SHALL be capped to at most 32ch with an ellipsis, and the address SHALL render as secondary text `127.0.0.1:<port><path>`. In the in-column slot the tray SHALL align to the slot's left edge (the dock's `mx-5` inset); the fixed no-composer fallback SHALL stay bottom-right.

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
#### Scenario: Root or absent path is omitted from the address
- **GIVEN** a server chip on port 57783 whose path is `/` or absent
- **THEN** the visible address SHALL be `127.0.0.1:57783` with no trailing `/`
- **AND** the tooltip and accessible name SHALL end at the same address (`<title> — 127.0.0.1:57783` followed by the probe hint)

#### Scenario: Address never truncates, accessible name carries the title
- **GIVEN** a server chip with a long title and path
- **THEN** the `127.0.0.1:<port>` part SHALL NOT shrink and only the path (then the label) SHALL truncate
- **AND** the tooltip and accessible name SHALL be `<title> — 127.0.0.1:<port><path>` followed by the existing probe hint ("Tap to probe 127.0.0.1 and open a restricted preview")
