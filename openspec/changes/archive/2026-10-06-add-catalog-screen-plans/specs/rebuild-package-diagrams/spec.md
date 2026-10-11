## ADDED Requirements

### Requirement: Screen plans and style kit in the catalog

`build-site` SHALL embed every `ui/plans/<screenId>.html` as the screen plan of that screen and `ui/style-kit.json` as the package style kit, and SHALL exit 1 writing no HTML when a plan file names no screen or dialog record. The catalog SHALL show a screen's plan on its screen page inside a sandboxed frame (scripts allowed, no same-origin access) with an action to open it in a new tab, SHALL open the named action on the screen page when the plan posts `{type: "screen-plan-open", screen, action}` for a known screen, and SHALL offer a Style kit page listing colour tokens with swatch, value, uses and cites, font tokens, font-size and radius scales, and components with selectors, declarations and cites.

#### Scenario: Plan and kit embedded
- **WHEN** the package holds `ui/plans/SCR-order.html` for screen `SCR-order` and `ui/style-kit.json`
- **THEN** the embedded UI model holds the plan HTML under `SCR-order` and the style kit tokens and components

#### Scenario: Orphan plan refused
- **WHEN** the package holds `ui/plans/SCR-ghost.html` and no screen `SCR-ghost`
- **THEN** `build-site` exits 1 naming `SCR-ghost` and writes no HTML
