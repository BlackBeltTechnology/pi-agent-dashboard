## MODIFIED Requirements

### Requirement: Substring match against display name

`Session…` search SHALL filter resident sessions using case-insensitive substring matching against the same string the user sees on the card. The matcher SHALL fall back through the same chain as `getSessionDisplayName`:
1. `name` if non-empty
2. `firstMessage` if no name
3. last segment of `cwd` if neither

Archived sessions SHALL NOT be searched client-side. When the `include archive` chip is on and the query has at least 3 characters, archived matches SHALL be fetched from the server (name / firstMessage only, no cwd fallback) and rendered per folder under an `Archive matches` section.

#### Scenario: Match against name
- **WHEN** a session has `name = "Refactor auth"` and the user types `auth`
- **THEN** the session SHALL appear in results

#### Scenario: Case-insensitive
- **WHEN** a session has `name = "Refactor Auth"` and the user types `AUTH`
- **THEN** the session SHALL appear in results

#### Scenario: Fallback to firstMessage when no name
- **WHEN** a session has `name = undefined` and `firstMessage = "explore the dashboard server"` and the user types `dashboard`
- **THEN** the session SHALL appear in results

#### Scenario: Fallback to cwd basename when no name and no firstMessage
- **WHEN** a session has `name = null`, `firstMessage = ""`, and `cwd = "/home/user/pi-shodh"` and the user types `pi-sho`
- **THEN** the session SHALL appear in results because its display name is the cwd basename

#### Scenario: Archived sessions excluded unless chip on
- **WHEN** the `include archive` chip is off and the user types text that matches only an archived session
- **THEN** no result SHALL be shown for that session

#### Scenario: Archived matches with chip on
- **WHEN** the `include archive` chip is on and the user types `auth` (≥ 3 chars) matching an archived session's name
- **THEN** that session SHALL appear as an archived row under its folder's `Archive matches` section
