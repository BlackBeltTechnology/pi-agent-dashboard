## ADDED Requirements

### Requirement: Shared fake developer workspace seed
The system SHALL maintain a central `seed/` directory containing fake developer workspace data. The initial seed SHALL cover at minimum the following UI states across five workspaces:

| Workspace | Minimum UI states covered |
|---|---|
| `seed/active-project/` | Multi-session sidebar (3 sessions: ask_user waiting, streaming, completed), flows dashboard (≥2 flows), settings panel |
| `seed/empty-workspace/` | Empty state (0 sessions), landing page, "spawn your first session" affordance |
| `seed/openspec-heavy/` | OpenSpec folder section (≥3 active changes, ≥2 archived), attach/detach flow, change-state toggles |
| `seed/multi-folder/` | ≥4 pinned directories with ≥2 sessions each, folder focus/compaction, cross-folder session search |
| `seed/error-states/` | Disconnected session card, failed tool call with retry badge, error banner, terminal in dead state |

Each workspace SHALL be a self-contained subdirectory with a `README.md` documenting which UI states it covers.

#### Scenario: Seed data is in native dashboard format
- **WHEN** `pi-dashboard --dev` starts with `PI_HOME` pointing to a seed workspace directory
- **THEN** the dashboard SHALL render sessions from the seed's JSONL files and `.meta.json` sidecars without errors
- **AND** no mock adapter or fixture layer SHALL be required

#### Scenario: Seed workspace README documents coverage
- **WHEN** an agent inspects `seed/<workspace>/README.md`
- **THEN** the file SHALL list each UI state the workspace covers with a one-line description

### Requirement: Organic growth of seed data
The system SHALL allow adding new seed data via `seed.patch` unified diff files during the archival process. Coverage of additional UI states grows incrementally as changes contribute patches.

#### Scenario: Seed data growth via patch
- **WHEN** a change provides extra seed data in `seed.patch`
- **THEN** the archival process applies this data to the shared `seed/` directory before the change is moved to archive/

#### Scenario: Seed data does not claim completeness
- **WHEN** a new dashboard UI state is introduced that is NOT covered by any seed workspace
- **THEN** the design sandbox SHALL render whatever the current dashboard code produces (the uncovered state produces a screenshot of whatever the dashboard renders — possibly an empty or default view)
- **AND** a subsequent change MAY add a `seed.patch` to cover the new state
