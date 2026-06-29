# playwright-e2e-qa Specification (delta)

## MODIFIED Requirements

### Requirement: PI_E2E_SEED makes the Docker harness provider-ready

The Docker test harness SHALL, when `PI_E2E_SEED=1`, seed credentials and
network trust so browser-driven scenario specs can clear the LandingPage
onboarding gate and reach network-guarded endpoints. The seed SHALL run in
`docker/test-entrypoint.sh` before the base entrypoint, SHALL be a no-op when
the target files already exist, and SHALL default OFF so manual
`docker/test-up.sh` QA stays UI-only. `tests/e2e/global-setup.ts` SHALL set
`PI_E2E_SEED=1` for managed runs and SHALL blank host provider API keys so they
never leak into the disposable container.

The same `PI_E2E_SEED` seed SHALL ALSO make the harness drive a key-free faux
model, so UI-spawned sessions can complete a prompt → streamed-events → rendered
DOM round-trip with no LLM credential. The seed SHALL stage the faux fixture as
a global auto-discovered pi extension at
`~/.pi/agent/extensions/faux-provider/index.ts` with its sibling
`faux-scenarios.ts` (subdir form, because the extension imports
`./faux-scenarios.js`), and SHALL seed `defaultModel: "faux/faux-1"` into the pi
config. No `-e` flag and no change to the dashboard spawn argv contract
(`sessionFlagsToArgv`) SHALL be required. Both seeds SHALL be no-ops when the
files already exist and SHALL default OFF.

#### Scenario: Seed clears the onboarding gate

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/auth.json` SHALL contain a fake `anthropic` OAuth credential
- **AND** `/api/provider-auth/status` SHALL report `anthropic` `authenticated:true` so `providersReady` is true
- **AND** the LandingPage step-2 ("Add folder") and step-3 ("Start session") CTAs SHALL be enabled

#### Scenario: Seed opens the network guard for the in-container browser

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/dashboard/config.json` SHALL set `trustedNetworks` to the RFC1918 private blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- **AND** the in-container browser (non-loopback source IP) SHALL receive 200 from `/api/browse` so the pin-directory dialog can list directories

#### Scenario: Seed stages a key-free faux model

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/extensions/faux-provider/index.ts` and its sibling `faux-scenarios.ts` SHALL exist (auto-discovered global extension)
- **AND** the pi config SHALL set `defaultModel` to `faux/faux-1`
- **AND** a session spawned through the dashboard UI SHALL load the faux provider (no "No API provider registered for api: faux") and select `faux/faux-1` with no LLM credential

#### Scenario: Default stays UI-only

- **WHEN** `docker/test-up.sh` runs WITHOUT `PI_E2E_SEED`
- **THEN** no credential, trusted-network, faux-extension, or `defaultModel` seed SHALL be written
- **AND** the harness SHALL remain UI-only

## ADDED Requirements

### Requirement: Faux fixture routes scenarios per session via prompt sentinel

The faux fixture (`qa/fixtures/faux-provider.ext.ts`) SHALL select its scripted
scenario per prompt from a `[[faux:<scenario-id>]]` sentinel in the latest user
message, looking the id up in the shared `qa/fixtures/faux-scenarios.ts`
catalog. Step selection within a multi-step scenario SHALL be derived from the
count of assistant turns since that user message, so multi-step scenarios (e.g.
`ask-select-roundtrip`) replay in order. When no sentinel is present the fixture
SHALL fall back to the `FAUX_SCRIPT` env scenario, preserving the existing
server-Vitest and VM-smoke behaviour. Per-session isolation SHALL rely on each
session being its own `pi --mode rpc` process (own extension instance + faux
state); no cross-session coordinator SHALL be introduced.

#### Scenario: Sentinel selects the scenario

- **WHEN** a prompt containing `[[faux:tool-read]]` is sent to a faux-backed session
- **THEN** the faux stream SHALL emit the `tool-read` scenario's scripted events

#### Scenario: No sentinel falls back to FAUX_SCRIPT

- **WHEN** a prompt with no `[[faux:…]]` sentinel is sent
- **THEN** the fixture SHALL serve the scenario named by the `FAUX_SCRIPT` env (existing default behaviour), and the existing server-Vitest + `qa/tests/10-faux-model.sh` SHALL remain green

#### Scenario: Concurrent sessions stay independent

- **WHEN** two faux-backed sessions receive prompts with different sentinels
- **THEN** each SHALL stream its own scenario, because each runs in its own pi process with its own faux state

### Requirement: Faux-backed model round-trip scenario specs

The suite SHALL include browser scenario specs that send a sentinel prompt
through the UI composer and assert the scripted assistant response renders in the
DOM — proving the `prompt → faux model → bridge → /ws → renderer` round-trip
without an LLM credential. Specs SHALL select on existing app `data-testid`s and
SHALL be idempotent with respect to shared-container state.

#### Scenario: Plain text round-trip renders

- **WHEN** a spec sends `[[faux:plain-text]]` through the composer of a spawned session
- **THEN** the scripted assistant text (`PLAIN_TEXT_MARKER`) SHALL become visible in the rendered message DOM

#### Scenario: Tool-call renderer round-trip

- **WHEN** a spec sends `[[faux:tool-read]]`
- **THEN** the `read` tool renderer SHALL mount, proving a faux tool-call streamed and rendered

#### Scenario: Interactive ask_user round-trip

- **WHEN** a spec sends `[[faux:ask-select]]`
- **THEN** the interactive select widget SHALL mount, proving a faux `ask_user` tool-call streamed and rendered
