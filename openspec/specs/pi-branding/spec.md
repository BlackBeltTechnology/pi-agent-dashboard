# pi-branding Specification

## Purpose

Places the pi logo in the sidebar header.

## Requirements

### Requirement: Pi logo in sidebar header
The sidebar header SHALL display a Pi brand element (π symbol) instead of the "Sessions" text. The brand element SHALL link to `/` (home route).

#### Scenario: Pi branding displayed
- **WHEN** the sidebar is visible
- **THEN** the header area shows a styled "π" symbol instead of "Sessions"

#### Scenario: Pi branding navigates home
- **WHEN** user clicks the Pi brand element in the sidebar header
- **THEN** the app navigates to `/`
