## ADDED Requirements

### Requirement: Modular router skill
The doctor SHALL be a single skill whose `SKILL.md` is a thin router that owns
no capability knowledge, delegating to self-contained capability MDs read on
demand.

#### Scenario: Route a symptom phrase to one module
- **WHEN** the user invokes the doctor with a symptom phrase (e.g. "flow won't
  show")
- **THEN** the router maps it to exactly one capability module (e.g.
  `plugins-bridges`) using the `symptoms:` front-matter declared by that module

#### Scenario: Route a named capability
- **WHEN** the user invokes the doctor with a capability name (e.g. "check
  peers")
- **THEN** the router runs only that module

#### Scenario: Full sweep with dependency ordering and short-circuit
- **WHEN** the user invokes the doctor with no hint or the word "full"
- **THEN** the router runs modules in dependency order (env → pi → peers →
  plugins → build → runtime) derived from each module's `depends-on:`
  front-matter
- **AND** a failure in a lower-layer module is reported as the root cause and
  suppresses misattributed failures in modules that depend on it (a missing pi
  is not reported as a broken bridge)

#### Scenario: Adding a module requires no router edit
- **WHEN** a new capability MD with `scope`, `symptoms:`, and `depends-on:`
  front-matter is added to the doctor directory
- **THEN** the router includes it in symptom routing and the sweep DAG without
  any edit to `SKILL.md`

### Requirement: Uniform capability-module contract
Every capability module MD SHALL contain the five parts: scope, knowledge,
checks, fix-routing, and derives-from (with a knowledge-hash reference).

#### Scenario: A module MD is well-formed
- **WHEN** a capability MD is authored or regenerated
- **THEN** it contains a one-sentence SCOPE, an authored KNOWLEDGE failure-mode
  map, runnable CHECKS, FIX ROUTING keyed by install topology, and a
  DERIVES-FROM list naming its live sources of truth plus its knowledge-hash
  sidecar

### Requirement: Derive-on-run, shell-first checks
Doctor checks SHALL derive dynamic facts from live sources at run time and SHALL
function without the dashboard server running.

#### Scenario: Runs with the server down
- **WHEN** the doctor runs while the dashboard server is not reachable
- **THEN** it derives facts from files and module resolution (settings.json,
  package.json, `createRequire`, the `shared/` resolver primitives)
- **AND** the report labels which facts are file-derived versus server-enriched

#### Scenario: Server-up enrichment is additive
- **WHEN** the dashboard server is reachable
- **THEN** the doctor additionally consumes `/api/health` and
  `/api/pi-core/versions` to enrich the report, without depending on them for a
  baseline result

#### Scenario: Facts are never hardcoded
- **WHEN** a derived fact (installed version, peer name, resolved path,
  recommended package set) is reported
- **THEN** it is read from the corresponding live source, not a copy embedded in
  the skill

### Requirement: Multi-location pi resolution reporting
The doctor SHALL report pi across all install locations and flag divergence and
floor violations.

#### Scenario: Report all pi installs
- **WHEN** the `pi-resolution` module runs
- **THEN** it reports the version and resolved path of every discoverable pi
  install (CLI binary, repo `node_modules`, managed install, nvm-global, and the
  per-session-cwd `createRequire` resolution)

#### Scenario: Flag divergence
- **WHEN** two pi locations resolve to different versions (e.g. CLI 0.80.3 vs
  server 0.80.2)
- **THEN** the doctor reports the divergence and identifies which location each
  consumer uses

#### Scenario: Flag floor violation
- **WHEN** any resolved pi version is below the `piCompatibility.minimum` floor
- **THEN** the doctor flags that location as failing with the required version

### Requirement: Peer resolution and name-skew detection
The doctor SHALL probe peers via tier-1 and tier-2 resolution and detect
published-name skew.

#### Scenario: Tier-1 miss with tier-2 hit is a pass
- **WHEN** a peer fails tier-1 `createRequire(cwd)` resolution but resolves via
  tier-2 pi `packages[]`
- **THEN** the doctor reports the peer present, naming the tier that resolved it

#### Scenario: Detect published bridge probing a dead name
- **WHEN** a shipped/published component probes a peer name that no longer
  resolves on npm after a rescope (e.g. `@pi/anthropic-messages`)
- **THEN** the doctor reports the name-skew, names the correct current package,
  and identifies the component version carrying the stale name

#### Scenario: Unresolvable peer parks the bridge
- **WHEN** neither peer name resolves via any tier
- **THEN** the doctor reports the dependent bridge as `waiting_peers` and names
  which peer failed with the resolver reason

### Requirement: Plugin and bridge health
The doctor SHALL surface plugin/bridge registration and activation state.

#### Scenario: Bridge visible to pi
- **WHEN** the `plugins-bridges` module runs
- **THEN** it reports each bridge's `bridgeLoadedFrom` and flags any bridge
  present only in `dashboardPluginBridges` (invisible to pi's `packages[]`
  reader) as misregistered

#### Scenario: Bridge activation status
- **WHEN** the anthropic bridge is not active
- **THEN** the doctor reports its status (`waiting_peers` / `degraded`) and the
  per-peer probe result explaining why

### Requirement: Build and reload state detection
The doctor SHALL detect the three-component rebuild/reload gaps.

#### Scenario: Stale client bundle in production mode
- **WHEN** the dashboard runs in production mode and `dist/client` predates the
  latest client/plugin source change
- **THEN** the doctor reports a stale bundle and routes to `npm run build` +
  restart

#### Scenario: Bridge not reloaded into live sessions
- **WHEN** the extension/bridge source changed but live sessions were not
  reloaded
- **THEN** the doctor reports the reload gap and routes to `npm run reload` or a
  fresh session

### Requirement: Install-topology awareness
The doctor SHALL adapt its checks and fix routing to the detected install
topology.

#### Scenario: Topology-specific fix routing
- **WHEN** a failure is detected
- **THEN** the remediation offered matches the detected topology (npm-global,
  Electron bundle, Docker, or dev checkout), including recognising the Electron
  bundle as immutable/read-only

### Requirement: Two-tier self-update with per-module knowledge-hash
The doctor SHALL keep derived facts current automatically and detect
authored-prose drift per module without silent self-rewrite.

#### Scenario: Derived facts never rot
- **WHEN** a source of truth changes (a peer is renamed, a recommended package
  is added, a version is bumped)
- **THEN** the next doctor run reflects the change automatically because the fact
  is derived, with no edit to the skill

#### Scenario: Detect authored-prose drift
- **WHEN** a module's `derives-from` sources change such that its stored
  `<module>.knowledge.hash` no longer matches the live hash
- **THEN** the doctor flags that module's authored prose as possibly stale and
  offers `--regenerate <module>`

#### Scenario: Regeneration is confirmed, never silent
- **WHEN** `--regenerate <module>` runs
- **THEN** the doctor re-derives that module's tables and proposes edits to its
  authored prose for confirmation, and does not overwrite prose without
  confirmation

### Requirement: Distribution via the extension package
The doctor skill SHALL ship in `packages/extension/.pi/skills/` so it loads in
every install topology.

#### Scenario: Present in every install
- **WHEN** the dashboard extension is installed in any topology
- **THEN** the doctor skill is available with no separate install step

### Requirement: AGENTS.md regeneration convention
The change SHALL add a module-scoped convention coupling source-of-truth changes
to the doctor module that must regenerate.

#### Scenario: Convention maps change to module
- **WHEN** a contributor renames a peer, adds a recommended package, bumps the pi
  floor, adds an install platform, or adds a bridge/plugin slot
- **THEN** the AGENTS.md Documentation Update Protocol row directs them to run
  `doctor --regenerate <module>` for the single affected module
