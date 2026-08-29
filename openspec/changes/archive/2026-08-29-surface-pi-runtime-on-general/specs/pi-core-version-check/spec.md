## MODIFIED Requirements

### Requirement: PiVersionAdvisory renders in Settings → General

A small client-side component SHALL surface `compatibility` to users via the Settings panel (NOT a full-app banner). The component receives `compatibility` from its host panel — which polls `/api/health` via the shared polling hook, once per panel instance — and renders one of three states:

- **Hidden**: `compatibility` is `null`, OR `error` is absent AND `upgradeRecommended` is falsy.
- **Soft warning**: `upgradeRecommended` is `true`. Yellow pill with one line: current version + recommended version + a link/disclosure for the upgrade command.
- **Hard advisory**: `error` is set. Red panel with the error message + a "How to upgrade" disclosure containing a copy-paste-able npm command.

#### Scenario: Advisory hidden when pi matches recommended

- **WHEN** `compatibility.current` equals `compatibility.recommended`
- **THEN** `PiVersionAdvisory` SHALL render nothing (no DOM)

#### Scenario: Advisory shows soft warning when below recommended

- **WHEN** `compatibility.upgradeRecommended` is `true`
- **AND** `compatibility.error` is absent
- **THEN** `PiVersionAdvisory` SHALL render a yellow pill including both `current` and `recommended` versions

#### Scenario: Advisory shows hard advisory when below minimum

- **WHEN** `compatibility.error` is a non-empty string
- **THEN** `PiVersionAdvisory` SHALL render a red panel with the error text AND an expandable "How to upgrade" disclosure containing an `npm install -g @earendil-works/pi-coding-agent@<recommended>` command

#### Scenario: Hook polls health every 60 seconds

- **WHEN** `usePiCompatibility` is mounted
- **THEN** it SHALL fetch `/api/health` immediately
- **AND** schedule a refetch every 60 seconds
- **AND** clean up the interval on unmount
