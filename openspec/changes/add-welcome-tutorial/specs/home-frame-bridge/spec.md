## ADDED Requirements

### Requirement: Opaque-origin frame hosting
A marker home page SHALL render in an iframe with `sandbox="allow-scripts"` and SHALL NOT include `allow-same-origin`, `allow-top-navigation`, or `allow-popups-to-escape-sandbox`. The parent SHALL fetch the page's entry document with its own credentials and supply it as the frame's `srcdoc`; the frame SHALL NOT be pointed at a dashboard URL. Binary assets SHALL reach the frame only through the bridge `asset` verb.

#### Scenario: Works for a paired remote device
- **GIVEN** a phone authenticated with a device bearer through a tunnel
- **WHEN** it opens the welcome folder home
- **THEN** the page and its screenshots SHALL render, with every file fetched by the parent using the bearer

#### Scenario: Asset path confined to the marker directory
- **WHEN** a frame posts `asset {path:"../../.pi/agent/auth.json"}`
- **THEN** the parent SHALL refuse it without issuing a request

#### Scenario: Sandbox attributes
- **WHEN** a marker home page renders
- **THEN** the iframe `sandbox` attribute SHALL contain `allow-scripts` and SHALL NOT contain `allow-same-origin`

#### Scenario: Frame has no ambient API authority
- **WHEN** script in the frame issues a mutating request to `/api/*`
- **THEN** the server SHALL reject it (Origin `null` is untrusted) and no state SHALL change

### Requirement: Versioned postMessage bridge
The parent SHALL accept a frame message only when `event.source` is the frame's `contentWindow`, the envelope is `{ pi: "home", v: 1, type, payload }`, the payload passes the verb's schema, and the verb is allowed for the frame's trust tier. Rejected messages SHALL be dropped and logged at most once per (directory, reason).

#### Scenario: Allowed navigation
- **GIVEN** a first-party frame
- **WHEN** it posts `{pi:"home", v:1, type:"navigate", payload:{to:"/settings/providers"}}`
- **THEN** the client SHALL navigate to `/settings/providers`

#### Scenario: Message from another window is ignored
- **WHEN** a message with a valid envelope arrives whose `event.source` is not the frame's `contentWindow`
- **THEN** the client SHALL ignore it

#### Scenario: Route outside the allowlist is ignored
- **WHEN** a frame posts `navigate` with `to` not matching an allowlisted route pattern
- **THEN** the client SHALL NOT navigate and SHALL log the rejection

#### Scenario: Unknown version is ignored
- **WHEN** a frame posts an envelope with `v: 2`
- **THEN** the client SHALL ignore it

### Requirement: Trust tiers
A frame SHALL be first-party only when its directory is the dashboard-managed welcome directory and its content matches the server's copy manifest. All other marker directories SHALL be "other". First-party frames MAY use `navigate`, `openDialog`, `spawn`, `applyRolePreset`, `refreshShots`. Other frames MAY use `navigate` only without confirmation; `spawn` SHALL require an explicit user confirmation; the remaining verbs SHALL be refused. Other-tier frames SHALL display a persistent label naming the directory the content comes from.

#### Scenario: Third-party spawn asks first
- **GIVEN** an other-tier frame
- **WHEN** it posts `spawn {prompt:"rm -rf"}`
- **THEN** the client SHALL show a confirm dialog with the full prompt and SHALL spawn only on confirm

#### Scenario: Third-party dialog verb refused
- **WHEN** an other-tier frame posts `openDialog {id:"providers-add"}`
- **THEN** the client SHALL refuse it

#### Scenario: Provenance label
- **WHEN** an other-tier frame renders
- **THEN** a label naming its source directory SHALL be visible outside the frame

### Requirement: Theme, language and status pushed to the frame
The parent SHALL post `theme {mode, name, vars}` and `lang {lang}` after `ready` and whenever they change. For first-party frames only, it SHALL post a `status` snapshot restricted to the documented field allowlist (counts, booleans, plugin enablement, tunnel status/provider, paired-device count, `trustedHasLoopback`, `features.remoteAccessSafe`, model capability rows `{id, family, input, reasoning, contextWindow, maxOutput, costIn, costOut}`, role → model refs). The snapshot SHALL NOT contain URLs, tokens, credentials, or filesystem paths.

#### Scenario: Live theme change
- **GIVEN** a rendered frame
- **WHEN** the user switches to dark mode
- **THEN** the parent SHALL post a `theme` message with `mode: "dark"` and the current CSS variable values

#### Scenario: Status excludes secrets
- **WHEN** a zrok tunnel is active with a public URL
- **THEN** the `status` snapshot SHALL report `tunnel.status` and `tunnel.provider` but SHALL NOT include the URL

#### Scenario: Other tier gets no status
- **WHEN** an other-tier frame posts `ready`
- **THEN** the parent SHALL send `theme` and `lang` but no `status`
