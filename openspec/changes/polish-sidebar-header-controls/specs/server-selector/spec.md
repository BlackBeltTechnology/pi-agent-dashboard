## MODIFIED Requirements

### Requirement: Server selector conforms to the UI contract and shows state in text
The header server selector and its dropdown SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal). The trigger is the sidebar header's connection chip: its visible content (server-kind glyph with status-dot badge, server name, offline cue) SHALL follow `sidebar-header` "Connection chip surfaces state that needs attention", its decorative glyphs and status dot SHALL be `aria-hidden`, and its accessible name SHALL include the connection state ("connected" or "offline"). Each entry's state (current, checking, available, unreachable, network not allowed, blocked in this browser, name not found, moved) SHALL be a severity pill with text — never only a colour or dot — at 12 px or larger, because it sits inside an interactive item.

#### Scenario: State is not carried by colour alone
- **WHEN** the dropdown lists one available, one unreachable and one CORS-blocked server, and the dashboard is connected
- **THEN** each entry shows a different text state pill, and the trigger's accessible name includes "connected"

#### Scenario: Probes pass in every theme
- **WHEN** the capture spec probes the open menu element (`role="menu"`, located from the page, not from the trigger's subtree) in `{base,dark}`, `{base,light}` and `{nord,dark}`
- **THEN** every contrast, size and focus failure list is empty
