# message-severity-tokens Specification (delta)

## ADDED Requirements

### Requirement: NotifyRenderer sources severity colour from the shared tokens

`NotifyRenderer.tsx` SHALL source its per-level colour from `--severity-*`
tokens, not from raw Tailwind literals. The existing no-raw-literals requirement
enumerates `Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx` and
`extension-ui/ToastSlot.tsx`; `NotifyRenderer` was omitted from that list and
still ships a `levelColors` map of `text-blue-400` / `text-green-400` /
`text-yellow-400` / `text-red-400`. It is added to the governed set.

The four `NotifyLevel` values SHALL map onto severity tiers 1:1:
`info→info`, `success→success`, `warning→warning`, `error→error`. In particular
`warning` SHALL resolve to the `--severity-warning-*` triple (derived from
`--accent-orange`), NOT to a yellow literal.

Contrast SHALL be held to the **existing relative gate** defined by this
capability — a 3:1 legibility floor per tier across all 18 theme·mode combos
with AA on the majority of cells. This change SHALL NOT introduce an absolute
"AA 4.5:1 in every theme" assertion, which that gate documents as unsatisfiable
because a derived tint cannot beat the tokens it derives from.

#### Scenario: No hardcoded severity colour in the notify renderer
- **WHEN** `NotifyRenderer` is inspected
- **THEN** it SHALL contain no `text-blue-400`, `text-green-400`, `text-yellow-400` or `text-red-400` literal
- **AND** each level's colour SHALL resolve from a `--severity-*` token

#### Scenario: Warning resolves to the orange-derived tier
- **WHEN** a notify with `level: "warning"` renders
- **THEN** its foreground SHALL resolve from `--severity-warning-fg`
- **AND** SHALL NOT be a yellow Tailwind literal

#### Scenario: Success tier gains its first consumer
- **WHEN** a notify with `level: "success"` renders
- **THEN** its background, border and foreground SHALL resolve from `--severity-success-{bg,border,fg}`
