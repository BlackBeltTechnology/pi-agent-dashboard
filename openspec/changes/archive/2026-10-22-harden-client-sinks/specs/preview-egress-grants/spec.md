# Spec Delta

## MODIFIED Requirements

### Requirement: Egress policy is fixed by provenance

A live-server preview opened by an operator action SHALL load external subresources without restriction. Operator actions are: a click in the file tree, the in-page preview overlay opened by a click, Expand on a preview card that itself has operator provenance, a linkified loopback URL, the canvas file chip, the canvas tool card, or a route-backed overlay URL (`/pi-view`, `/folder/<cwd>/view`) carrying a navigation intent that verifies for its route and target. Every other open SHALL be restricted, including canvas auto-open, the confirm-chip tap for an agent-declared server or URL, agent preview cards, a route-backed overlay URL without a verifying navigation intent, and any surface declaring no provenance. The policy SHALL be bound to the capability so no URL edit can widen it.

#### Scenario: Manual open loads a CDN

- **GIVEN** a local `.html` that loads `https://cdn.tailwindcss.com`
- **WHEN** the user clicks it in the file tree
- **THEN** the CDN script loads and the page renders styled

#### Scenario: Auto-open blocks an ungranted CDN

- **GIVEN** the same file and no grant for `https://cdn.tailwindcss.com`
- **WHEN** the canvas auto-opens it
- **THEN** the CDN request is blocked by the preview's content security policy

#### Scenario: Agent-declared dev server is restricted

- **GIVEN** the agent declares `http://localhost:54321/` whose page loads `https://unpkg.com/x.js`
- **WHEN** the user taps its confirm chip
- **THEN** the unpkg request is blocked and listed in the banner

#### Scenario: Chip tap is an operator open

- **GIVEN** the mobile canvas chip for an agent-written `.html`
- **WHEN** the user taps it
- **THEN** the preview opens with the open policy

#### Scenario: Editing the URL cannot widen egress

- **GIVEN** an auto-opened restricted preview
- **WHEN** the frame URL's path or query is changed
- **THEN** the same restricted policy still applies

#### Scenario: Crafted overlay link stays restricted

- **GIVEN** a `/folder/<cwd>/view?path=page.html` link with no navigation intent, opened from outside the dashboard
- **WHEN** the overlay renders the page, which loads `https://unpkg.com/x.js`
- **THEN** the unpkg request is blocked

#### Scenario: Reloaded operator overlay keeps the open policy

- **GIVEN** the operator opened `page.html` in the route-backed overlay through the UI, so the URL carries a verifying intent
- **WHEN** the page is reloaded within the intent lifetime
- **THEN** the preview opens with the open policy
