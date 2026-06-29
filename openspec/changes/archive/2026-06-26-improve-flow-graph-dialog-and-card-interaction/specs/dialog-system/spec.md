# dialog-system delta

## MODIFIED Requirements

### Requirement: Dialog size variants

The `Dialog` SHALL accept `size="sm" | "md" | "lg" | "full"` (default `md`),
mapping `sm`/`md`/`lg` to `max-w-sm`/`max-w-md`/`max-w-lg` and `full` to
`max-w-[95vw]`. The `sm`/`md`/`lg` variants apply `max-h-[80vh]`; the `full`
variant applies `max-h-[92vh]`. All variants use internal scroll when content
exceeds the height cap.

#### Scenario: Default size

- **WHEN** a `Dialog` is rendered without `size`
- **THEN** the container SHALL apply `max-w-md`

#### Scenario: Explicit small size

- **WHEN** a `Dialog` is rendered with `size="sm"`
- **THEN** the container SHALL apply `max-w-sm`

#### Scenario: Explicit large size

- **WHEN** a `Dialog` is rendered with `size="lg"`
- **THEN** the container SHALL apply `max-w-lg`

#### Scenario: Explicit full size

- **WHEN** a `Dialog` is rendered with `size="full"`
- **THEN** the container SHALL apply `max-w-[95vw]` and `max-h-[92vh]`

#### Scenario: Tall content scrolls inside

- **WHEN** a `Dialog`'s body content exceeds its height cap
- **THEN** the container SHALL apply its `max-h` (`80vh` for sm/md/lg,
  `92vh` for full) with internal `overflow-y-auto`, leaving the overlay
  non-scrolling

## ADDED Requirements

### Requirement: Dialog flush (edge-to-edge) body

The `Dialog` SHALL accept `flush?: boolean` (default `false`). When `true`,
the container SHALL drop its inner padding (`p-5 space-y-4`) and clip overflow
(`overflow-hidden`) instead of `overflow-y-auto`, so a self-framed child (one
that renders its own header + scrollable body) fills the dialog as a single
window and manages its own scroll. When `false`, padding + internal scroll are
unchanged.

#### Scenario: Flush drops padding

- **WHEN** a `Dialog` is rendered with `flush`
- **THEN** the container SHALL apply `overflow-hidden` and SHALL NOT apply
  `p-5`

#### Scenario: Non-flush keeps padding + scroll

- **WHEN** a `Dialog` is rendered without `flush`
- **THEN** the container SHALL apply `p-5` and `overflow-y-auto`
