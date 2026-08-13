## ADDED Requirements

### Requirement: The harness SHALL survive a full suite run within its memory cap

The Docker test harness SHALL complete an entire browser-E2E suite run without exhausting its container memory cap. The cap is declared by `docker/compose.yml` (`MEM_LIMIT`, default 4 GiB) and inherited by the test overlay; the harness SHALL stay within it by bounding the number of concurrently resident dashboard-spawned pi sessions, NOT by raising the cap.

The dominant consumer SHALL be treated as spawned pi session processes (measured at 150–280 MB RSS each against a ~630 MB dashboard server). The RAM-backed `pi-state` tmpfs SHALL NOT be assumed to be the consumer: it was measured at 19 MB of its 2 GB during an exhausted run.

#### Scenario: A full run finishes with the container healthy

- **WHEN** the complete browser-E2E suite runs against one harness container
- **THEN** the run SHALL reach its final spec
- **AND** the container SHALL still report healthy at the end
- **AND** the dashboard daemon SHALL NOT have been restarted except by the spec that deliberately calls `POST /api/restart`

#### Scenario: Memory does not climb across the run

- **WHEN** container memory is sampled out-of-band (from the host, against the container's own cgroup) after an early chunk of specs and again after a later chunk
- **THEN** `memory.current` after the later chunk SHALL be no greater than the early-chunk sample plus 10 %
- **AND** the count of resident pi session processes SHALL NOT grow with the number of specs executed

#### Scenario: Resident process count tracks the reported session count

- **WHEN** the resident pi process count and the dashboard's live-session count are sampled at the same point in a run
- **THEN** any persistent divergence SHALL be recorded, because a process invisible to the session list is invisible to the suite's own leak guard

#### Scenario: The memory cap is unchanged by this guarantee

- **WHEN** the harness configuration is inspected after this change
- **THEN** the declared memory cap SHALL be unchanged
- **AND** the healthcheck cadence and the PID-1 supervisor restart-grace behaviour SHALL be unchanged
