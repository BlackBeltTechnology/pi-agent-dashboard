## ADDED Requirements

### Requirement: Host-design guidance for plugin UI
The `dashboard-plugin-scaffold` skill SHALL ship a host-design reference inside its published skill directory. The reference SHALL tell plugin authors how plugin UI matches the dashboard host:
- use host theme tokens for surfaces, text, borders and severity/status, with no raw color literals;
- use the accent-text tokens for colored text;
- support both dark and light mode;
- add no own theme, font stack or global styles;
- apply the `product-ui` anti-slop profile.

The next-steps blocks for both the `new` and `augment` modes in the skill document SHALL name this reference. The reference SHALL state that it is derived from the dashboard UI contract. Every CSS custom property the reference names SHALL be declared in the dashboard client's token layer.

#### Scenario: Reference ships with the skill
- **WHEN** the published plugin-skill package contents are listed
- **THEN** the host-design reference is included under the skill directory

#### Scenario: Next-steps point to host design
- **WHEN** the skill document's `new` and `augment` next-steps blocks are read
- **THEN** each names the host-design reference

#### Scenario: Token drift is caught
- **WHEN** the reference names a CSS custom property that the dashboard client token layer does not declare
- **THEN** verification fails
