# bridge-source-detection Specification

## Purpose

Classify the source environment of the current pi session into a single
`SessionSource` value (`tui`, `zed`, `tmux`, or `dashboard`) so the bridge can
report where the session originated on `session_register`. Detection reads the
presence of a TUI, the `ZED_TERM` and `TMUX` environment variables, and an
optional `.meta.json` sidecar next to the session's `.jsonl` file.

## Requirements

### Requirement: TUI-attached session classification

When a TUI (interactive UI) is attached, the session SHALL be classified as an
interactive terminal session, and any `.meta.json` sidecar SHALL be ignored so
that a stale or by-cwd-matched `dashboard` stamp cannot mislabel an interactive
session.

#### Scenario: pi TUI running inside Zed's terminal

- WHEN a TUI is attached
- AND the `ZED_TERM` environment variable is set
- THEN the source SHALL resolve to `tui`

#### Scenario: pi TUI running inside a tmux session

- WHEN a TUI is attached
- AND the `ZED_TERM` environment variable is not set
- AND the `TMUX` environment variable is set
- THEN the source SHALL resolve to `tmux`

#### Scenario: plain interactive TUI

- WHEN a TUI is attached
- AND neither `ZED_TERM` nor `TMUX` is set
- THEN the source SHALL resolve to `tui`

### Requirement: Headless session classification

When no TUI is attached, the session SHALL be treated as headless and
classified by first consulting the `.meta.json` sidecar for a dashboard stamp,
then falling back to environment variables in priority order.

#### Scenario: dashboard-spawned headless session

- WHEN no TUI is attached
- AND a session file path is provided
- AND its `.meta.json` sidecar has `source` equal to `dashboard`
- THEN the source SHALL resolve to `dashboard`

#### Scenario: headless session inside Zed's agent

- WHEN no TUI is attached
- AND no `.meta.json` sidecar marks the source as `dashboard`
- AND the `ZED_TERM` environment variable is set
- THEN the source SHALL resolve to `zed`

#### Scenario: headless session inside tmux

- WHEN no TUI is attached
- AND no `.meta.json` sidecar marks the source as `dashboard`
- AND `ZED_TERM` is not set
- AND the `TMUX` environment variable is set
- THEN the source SHALL resolve to `tmux`

#### Scenario: headless session with no distinguishing signal

- WHEN no TUI is attached
- AND no `.meta.json` sidecar marks the source as `dashboard`
- AND neither `ZED_TERM` nor `TMUX` is set
- THEN the source SHALL resolve to `tui`

### Requirement: Detection precedence

Detection SHALL evaluate signals in a fixed priority order so that a single
source value is always produced.

#### Scenario: TUI attachment overrides the sidecar

- WHEN a TUI is attached
- AND a session file path with a `.meta.json` sidecar marked `dashboard` is provided
- THEN the source SHALL be determined by the TUI-attached rules
- AND the source SHALL NOT resolve to `dashboard`

#### Scenario: dashboard sidecar overrides environment variables

- WHEN no TUI is attached
- AND the `.meta.json` sidecar marks the source as `dashboard`
- AND `ZED_TERM` or `TMUX` is set
- THEN the source SHALL resolve to `dashboard`

#### Scenario: ZED_TERM takes precedence over TMUX

- WHEN both `ZED_TERM` and `TMUX` are set
- THEN `ZED_TERM` SHALL be evaluated before `TMUX` in both the TUI-attached and headless paths
