## ADDED Requirements

### Requirement: /api/health surfaces pi-version compatibility

The `/api/health` REST response SHALL include a `compatibility` field of shape `BootstrapCompatibility | null`. The field is computed lazily per request from `pi-version-skew.ts` primitives (`readPiCompatibility` for the declared range + `readCurrentPiVersion` for the running pi + `computeCompatibility` to combine them), and cached for 30 seconds to avoid repeated registry probes and file reads on rapid health polls.

When pi cannot be resolved (no global install, no managed install, no override), `compatibility` SHALL be `null` — NOT an error, since a freshly-installed dashboard may legitimately predate a pi install.

#### Scenario: Health response includes compatibility on a clean install with pi resolvable

- **WHEN** `GET /api/health` is called
- **AND** `readCurrentPiVersion()` returns `"0.75.5"`
- **AND** `piCompatibility.minimum` is `"0.75.0"` and `recommended` is `"0.75.5"`
- **THEN** the response SHALL include `compatibility: { minimum: "0.75.0", recommended: "0.75.5", maximum: null, current: "0.75.5" }`
- **AND** neither `upgradeRecommended` nor `error` SHALL be set

#### Scenario: Health response surfaces upgrade hint when pi is below recommended

- **WHEN** `readCurrentPiVersion()` returns `"0.75.0"`
- **AND** `piCompatibility.recommended` is `"0.75.5"`
- **THEN** `compatibility.upgradeRecommended` SHALL be `true`
- **AND** `compatibility.error` SHALL be absent

#### Scenario: Health response surfaces blocking error when pi is below minimum

- **WHEN** `readCurrentPiVersion()` returns `"0.74.2"`
- **AND** `piCompatibility.minimum` is `"0.75.0"`
- **THEN** `compatibility.error` SHALL be a non-empty string containing both versions
- **AND** the response status SHALL remain `200` (the field signals state; the handler does not refuse the request)

#### Scenario: Health response sets compatibility to null when pi is unresolvable

- **WHEN** `readCurrentPiVersion()` returns `undefined`
- **THEN** `compatibility` SHALL be `null`
- **AND** the response SHALL otherwise be unchanged

#### Scenario: Compatibility result is cached for 30 seconds

- **WHEN** two `/api/health` requests are made within 30 seconds of each other
- **THEN** `readCurrentPiVersion()` SHALL be called at most once during that window
- **AND** the second response SHALL include the cached `compatibility` value

### Requirement: PiVersionAdvisory renders in Settings → General

A small client-side component SHALL surface `compatibility` to users via the Settings panel (NOT a full-app banner). The component reads `/api/health` via a polling hook and renders one of three states:

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
