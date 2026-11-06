# dashboard-mockup-wiring Specification

## Purpose
Wire this repository, as one consumer of the mockup loop, so agents here always reach
the live mock workflow and new static boards are visible in review.

## Requirements

### Requirement: Adapter loads the workspace skill
This repository's mockup adapter skill SHALL load the workspace copy of the generic
mockup-loop skill, not an installed copy, so unreleased skill changes apply before the
next release. The mockup-loop package SHALL NOT be version-bumped or published outside
the monorepo release.

#### Scenario: Unreleased skill change
- **WHEN** the workspace skill text differs from the installed package's skill text
- **THEN** an agent following the project adapter reads the workspace text

### Requirement: Root routing line
This repository's root agent instructions SHALL carry one routing line that sends mock
work to the dashboard mockup adapter skill.

#### Scenario: Routing line present
- **WHEN** the root `AGENTS.md` of this repository is read
- **THEN** it holds one line routing mock, mockup, UI-option and variant requests to the dashboard adapter skill

### Requirement: Mock check
A mock check in this repository SHALL compare against a base revision and report every
new entry under a mock root (`mockups/` or a change's `mockups/`) that is not a live
mock. A directory passes if it holds `mock.tsx` under a dated id, or a `STATIC.md`
naming the static exception. A loose `.html` file is always reported: a static board
SHALL live in its own directory, so adoption moves it whole with its exemption. The
check is advisory until a follow-up change adds it to the ship gate.

#### Scenario: Static board without exception
- **WHEN** a change adds `openspec/changes/x/mockups/2026-12-01-y/index.html` with no `mock.tsx` and no `STATIC.md`
- **THEN** the mock check reports that directory

#### Scenario: Loose static file
- **WHEN** a change adds `mockups/new-board.html`
- **THEN** the mock check reports that file and says to move it into a directory with `STATIC.md`

#### Scenario: Adopted static board keeps its exemption
- **WHEN** a `mockups/<slug>/` static board with `STATIC.md` is adopted into a change
- **THEN** the mock check still passes it at its new path

#### Scenario: Static board with exception
- **WHEN** the same directory holds `STATIC.md` naming the geometry-repro exception
- **THEN** the mock check passes it
