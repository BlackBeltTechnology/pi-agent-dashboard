## Purpose

The session sidebar is the primary navigation surface in the dashboard chrome. It displays the Pi brand mark, filter controls, and folder/session groupings, and SHALL render consistently across desktop and mobile shells.

## Requirements

### Requirement: Sidebar header
The sidebar header SHALL display Pi branding (π symbol) that links to home (`/`) instead of the static "Sessions" text. The arrangement of the other header controls is governed by the `sidebar-header` capability.

#### Scenario: Header displays Pi branding
- **WHEN** the sidebar is rendered
- **THEN** the header shows the Pi brand mark linking to `/`

#### Scenario: Header no longer shows Sessions text
- **WHEN** the sidebar is rendered
- **THEN** the text "Sessions" does not appear in the sidebar header

### Requirement: Folder group content
Each folder group SHALL contain the group header (folder name, git info), the folder action bar, optional OpenSpec section, and pi session cards only. Terminal cards SHALL NOT appear in the folder group. The unified sort order SHALL contain only pi session IDs.

#### Scenario: Folder group with sessions and terminals
- **WHEN** a folder has 2 pi sessions and 3 terminals
- **THEN** the sidebar SHALL show 2 pi session cards in the folder group
- **THEN** no terminal cards SHALL appear in the sidebar
- **THEN** the Terminals button in the action bar SHALL show `Terminals(3)`

#### Scenario: Folder group with no sessions
- **WHEN** a folder has no pi sessions but has pinned directory status
- **THEN** the folder group SHALL show the action bar with all buttons
- **THEN** no session cards SHALL appear

### Requirement: Sidebar header brand mark (PiLogo)
The sidebar header SHALL display the Pi brand mark via a shared inline-SVG React component (`PiLogo`) that links to home (`/`), instead of a literal `π` text character, a raster `<img>`, or the static "Sessions" text. Both sidebar implementations — the desktop sidebar header in `SessionList.tsx` and the alternate sidebar header in `SessionSidebar.tsx` — SHALL use the same `PiLogo` component. The SVG SHALL use `fill="currentColor"` so it inherits the surrounding text color (no opaque background, fully transparent in both light and dark themes), and SHALL expose `role="img"` with `aria-label="Pi Dashboard"`. The wrapping `<button>` SHALL retain `title="Home"`, click-to-home navigation, and theme-color styling (`text-blue-500 hover:text-blue-400 transition-colors`). The desktop header SHALL place the Discord link immediately after the home button; all other header controls follow the `sidebar-header` capability.

#### Scenario: Header displays Pi branding via PiLogo SVG
- **WHEN** the sidebar is rendered
- **THEN** the header home button contains an `<svg>` element with `aria-label="Pi Dashboard"`
- **AND** the button links to `/`
- **AND** in the desktop header the next control after the button SHALL be the Discord link

#### Scenario: Header brand element is not a text glyph or raster image
- **WHEN** the sidebar is rendered
- **THEN** the home button does NOT contain an `<img>` element
- **AND** no literal "π" text node is rendered inside the button
- **AND** the text "Sessions" does not appear in the sidebar header

#### Scenario: Brand button still navigates home
- **WHEN** the user clicks the sidebar header brand button
- **THEN** the client navigates to `/` (the dashboard home route)

#### Scenario: Brand mark inherits theme color
- **WHEN** the dashboard is in light theme
- **THEN** the PiLogo SVG renders with no opaque background and inherits the parent button's `text-blue-500` color
- **WHEN** the dashboard is in dark theme
- **THEN** the PiLogo SVG renders with no opaque background and inherits the parent button's `text-blue-500` color

#### Scenario: Brand button has hover affordance
- **WHEN** the user hovers the sidebar header brand button
- **THEN** the SVG visually responds via the button's `hover:text-blue-400` color transition
- **AND** the `title="Home"` tooltip is exposed for assistive technologies
