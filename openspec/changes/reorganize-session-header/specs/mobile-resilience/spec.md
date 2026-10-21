## REMOVED Requirements

### Requirement: Separate attach/detach icon in mobile session header
**Reason**: Attach leaves the session header (see the `session-header` capability). The mobile header is one row: back, title, context ring, layout menu and the ⋯ button.
**Migration**: Attach a change from the session card or from the composer session actions ("Attach change..." chip). Detach stays in the mobile ⋯ menu (`MobileActionMenu`, "Detach: <name>" when a change is attached), on the session card and in the composer. The mobile ⋯ menu has no Attach item.
