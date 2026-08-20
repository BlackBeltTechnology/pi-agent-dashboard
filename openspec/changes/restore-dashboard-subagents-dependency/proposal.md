## Why

The enabled Subagent Inspector plugin reported `@blackbelt-technology/pi-dashboard-subagents` as missing even though Pi settings declared the package. Restore the package cache, activate the Dashboard source that contains the plugin inventory, and verify the live requirement report.

## What Changes

- Ensure Pi resolves `npm:@blackbelt-technology/pi-dashboard-subagents` from its global package cache.
- Activate the clean `f843084d7456550cec24103e7a43189afeb79871` Dashboard worktree and restart the Dashboard on port `8147`.
- Disable Apple Tools on this Linux host because its iMCP dependency requires macOS 15.3 or later.
- Replace the installed `npm:@sting8k/pi-vcc` package with `npm:pi-blackhole`, as required by Blackhole's upstream compatibility instructions.
- Install `npm:pi-hermes-memory` alongside the existing memory systems.
- Reload connected Pi sessions once after the package changes.
- Verify every enabled plugin has an empty `missingRequirements` list.
- Inventory bridge path conflicts separately. Do not change their configured paths in this change.
- Correct the canonical `fix-worktree-opsx-skills-not-created` skill so it uses the repository-pinned OpenSpec command and validates required skill names instead of a stale count.
- Do not change application behavior, APIs, manifests, lockfiles, or application source code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change repairs one runtime installation and does not change product requirements. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Runtime package cache: `@blackbelt-technology/pi-dashboard-subagents`, `pi-blackhole`, and `pi-hermes-memory` under `~/.pi/agent/npm/node_modules/`.
- Pi settings: remove `npm:@sting8k/pi-vcc`; add `npm:pi-blackhole` and `npm:pi-hermes-memory`.
- Dashboard config: set `plugins.apple-tools.enabled` to `false`.
- Runtime Dashboard installation: the global `@blackbelt-technology/pi-agent-dashboard` link and the process listening on port `8147`.
- Repository: OpenSpec change artifacts, the canonical OpenSpec worktree-recovery skill, and its `AGENTS.md` purpose row. No application source or dependency declaration changes.
- Validation: `pi list`, package metadata, `GET /api/health`, and `GET /api/plugins`.

## Discipline Skills

No `eng-disciplines` skills apply. This is an operational package repair with no source-code change.
