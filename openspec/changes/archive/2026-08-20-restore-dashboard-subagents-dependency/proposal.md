## Why

The enabled Subagent Inspector plugin reported `@blackbelt-technology/pi-dashboard-subagents` as missing even though Pi settings declared the package. Restore the package cache, activate the Dashboard source that contains the plugin inventory, and verify the live requirement report.

## What Changes

- Ensure Pi resolves `npm:@blackbelt-technology/pi-dashboard-subagents` from its global package cache.
- Activate the clean `f843084d7456550cec24103e7a43189afeb79871` Dashboard worktree and restart the Dashboard on port `8147`.
- Disable Apple Tools on this Linux host because its iMCP dependency requires macOS 15.3 or later.
- Replace the installed `npm:@sting8k/pi-vcc` package with `npm:pi-blackhole`, as required by Blackhole's upstream compatibility instructions.
- Remove `npm:pi-hermes-memory` after a fresh Pi process failed because Hermes registered `skill_manage`, which conflicts with the existing global `skill-manage.ts` extension. Do not delete cached files or repository integration code.
- Add a user-scope rule that every global Pi package, extension, skill, prompt, theme, provider, or settings mutation requires a bounded fresh Pi startup with normal extensions before completion.
- Reload connected Pi sessions once after the earlier package changes. The later Hermes removal applies when each existing session next reloads.
- Verify the Subagent Inspector dependency remains healthy. Accept that the enabled Hermes Memory dashboard plugin reports its removed extension requirement as missing.
- Inventory bridge path conflicts separately. Do not change their configured paths in this change.
- Correct the canonical `fix-worktree-opsx-skills-not-created` skill so it uses the repository-pinned OpenSpec command and validates required skill names instead of a stale count.
- Make two legacy auto-start test helpers inject a host CLI path so the suite is independent of whether it runs from a Git worktree. Production behavior remains unchanged.
- Make the KB stale-property test force its second reindex so it does not depend on two writes receiving different filesystem timestamps.
- Drain TanStack Virtual's 150 ms scroll-reset callback after ChatView tests so it cannot update React after jsdom removes `window` under full-suite load.
- Correct the CI troubleshooting skill after its deleted helper script blocks failure-log retrieval.
- Ship the repository correction to `develop` through a reviewed pull request.
- Replace the worktree-linked Pi extension with published `@blackbelt-technology/pi-dashboard-extension@0.7.0` and pass the fresh-start gate. Keep the Dashboard server worktree link because the published root package starts with zero discovered plugins.
- Do not change application behavior, APIs, manifests, lockfiles, or application source code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change repairs one runtime installation and does not change product requirements. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Runtime package cache: `@blackbelt-technology/pi-dashboard-subagents` and `pi-blackhole` under `~/.pi/agent/npm/node_modules/`. Pi can retain unreferenced `pi-hermes-memory` cache files after settings removal.
- Pi settings: remove `npm:@sting8k/pi-vcc` and `npm:pi-hermes-memory`; retain `npm:pi-blackhole`.
- Global agent guidance: add the fresh Pi startup gate to `~/.pi/agent/AGENTS.md`.
- Dashboard config: set `plugins.apple-tools.enabled` to `false`.
- Runtime Dashboard installation: replace the linked Pi extension source with `npm:@blackbelt-technology/pi-dashboard-extension@0.7.0`. Retain the global Dashboard server worktree link after a published-root test discovered zero plugins.
- Repository: OpenSpec artifacts; two corrected skills; checkout-independent auto-start seams; deterministic KB reindex and ChatView cleanup test support. Ship them to `develop`; no application source or dependency declaration changes.
- Validation: `pi list`, package metadata, `GET /api/health`, `GET /api/plugins`, and a bounded fresh Pi process with normal extensions. `pi list` must not contain `npm:pi-hermes-memory` after removal.

## Discipline Skills

No `eng-disciplines` skills apply. This is an operational package repair with no source-code change.
