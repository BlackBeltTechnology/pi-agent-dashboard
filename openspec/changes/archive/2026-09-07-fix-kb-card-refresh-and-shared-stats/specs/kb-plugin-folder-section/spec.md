# kb-plugin-folder-section — delta

## MODIFIED Requirements

### Requirement: Reindex action affordance

The KB folder section's **sidebar** placement SHALL NOT render an action control inside its pill. It SHALL instead contribute a single declarative reindex item to the `folder-actions-menu` slot, in the `MAINTENANCE` group, which triggers a reindex of the folder's KB.

That menu contribution SHALL be made ONLY from the section's sidebar placement. The worktree-card placement's scope has no folder actions menu, and the section SHALL register nothing there — otherwise its item lands in a scope with nothing to render it. See `folder-actions-menu` → "Card-placement sections do not register".

The **card** placement SHALL instead render a compact reindex control as a **sibling of the pill, outside the pill root**, so the card surface has a direct reindex affordance despite having no folder actions menu, while the pill itself stays action-free in every placement (no interactive element nests inside the pill's button root). The sibling control SHALL express the same state-varying action as the menu item — "Retry" in the `error` state, in-progress and disabled in the `indexing` state, "Index now" in the `not-indexed` state, and "Reindex now" in the `stale` or `populated` state — and SHALL be disabled for the whole busy window (pending or a running job). Activating the sibling control, by pointer or keyboard, SHALL trigger only the reindex; it SHALL NOT also activate the pill's open-settings navigation. Its state label SHALL remain perceivable while the control is disabled.

Each placement exposes ONE affordance, and each expresses every state through its own attributes rather than separate controls. The **menu item** (sidebar) varies its label, badge and disabled state: "Retry" in `error`, disabled with an in-progress indication in `indexing`, "Index now" in `not-indexed`, "Reindex now" in `stale` or `populated`, carrying the stale badge when stale. The **sibling control** (card) varies its accessible name/tooltip and disabled state with the same labels; it carries NO badge — the pill's inline stale marker already renders that fact on the same card.

#### Scenario: State varies the single menu item

- **WHEN** the KB is in the `error` state
- **THEN** the menu SHALL show one KB item labelled "Retry" that calls `reindex()` on activation
- **WHEN** the KB is in the `indexing` state
- **THEN** the menu SHALL show one KB item that is disabled and indicates progress
- **WHEN** the KB is in the `not-indexed` state
- **THEN** the menu SHALL show one KB item labelled "Index now" that calls `reindex()` on activation
- **WHEN** the KB is in the `stale` or `populated` state
- **THEN** the menu SHALL show one KB item labelled "Reindex now" that calls `reindex()` on activation

#### Scenario: Never more than one KB action

- **WHEN** the menu renders for any KB state
- **THEN** exactly one KB reindex item SHALL render

#### Scenario: Pill carries no action control

- **WHEN** the KB folder section renders its pill in any placement
- **THEN** no reindex, retry or index-now control SHALL render inside the pill root

#### Scenario: Card placement renders a sibling reindex control

- **WHEN** the KB folder section renders in the card placement
- **THEN** exactly one compact reindex control SHALL render as a sibling of the pill, outside the pill root, whose action matches the KB state (Retry / Index now / Reindex now)
- **AND** no folder-actions-menu item SHALL be registered from the card placement
- **AND** the sidebar placement SHALL render no such sibling control

#### Scenario: Card sibling control disabled while busy

- **WHEN** the card placement's KB is pending or `indexing`
- **THEN** the sibling control SHALL render disabled and SHALL NOT invoke `reindex()` on activation
- **AND** its state label SHALL remain perceivable while disabled

#### Scenario: Card sibling control does not open settings

- **WHEN** the user activates the card placement's sibling reindex control by pointer or by keyboard
- **THEN** a reindex SHALL be triggered
- **AND** the KB settings page SHALL NOT open from that activation
