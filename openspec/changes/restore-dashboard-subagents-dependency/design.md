## Context

Pi settings already contain `npm:@blackbelt-technology/pi-dashboard-subagents`. The package cache now contains version `0.2.4`, and `pi list` resolves it. The live Dashboard process still runs global Dashboard `0.6.1`, which discovers zero plugins because that install contains only the core `packages/{server,shared,extension}` source directories.

The clean worktree contains Dashboard `0.7.0`, 13 plugin manifests, and a generated production client bundle. Four plugin bridge paths conflict with existing live source paths. Those existing paths still exist, so the bridge registrar correctly refuses to replace them.

After activation, the newer plugin set exposed three requirements that were absent from the starting runtime: Apple Tools needs a macOS iMCP path, Blackhole needs `pi-blackhole`, and Hermes Memory needs `pi-hermes-memory`. The user chose to disable Apple Tools, replace the installed pi-vcc package with Blackhole, and install Hermes Memory alongside the existing memory systems.

## Goals / Non-Goals

**Goals:**

- Make the live Dashboard use the clean worktree that contains the Subagent Inspector plugin.
- Preserve the existing Pi package declaration and installed package version.
- Restart through the Dashboard restart endpoint so connected sessions can reattach.
- Apply the user's activation choices for Apple Tools, Blackhole, and Hermes Memory.
- Prove that all enabled plugins report no missing requirements.

**Non-Goals:**

- Change source code, dependency manifests, lockfiles, or API behavior.
- Replace existing bridge paths.
- Fix bridge path conflicts or other plugin load errors.
- Configure Blackhole or Hermes Memory beyond their package defaults.
- Merge the feature branch.

## Decisions

### Reuse the installed Pi package

Do not run another install when `pi list` and the package metadata both resolve `@blackbelt-technology/pi-dashboard-subagents@0.2.4`. A second install adds network and package-manager risk without changing the result.

Alternative: run `pi update npm:@blackbelt-technology/pi-dashboard-subagents`. Rejected because the required package is already present and the requirement probe checks presence, not a newer version.

### Apply the package migration with Pi's package manager

Remove the exact configured source `npm:@sting8k/pi-vcc` before installing `npm:pi-blackhole`. Blackhole's upstream README states that standalone pi-vcc and Blackhole conflict because both own Pi's compaction hook. Install `npm:pi-hermes-memory` separately; the user accepted overlap with Hindsight and Total Agent Memory.

Use Pi's package commands rather than editing `settings.json` or package-cache files. Reload connected sessions once after all package operations so the new extension set activates together.

Package review: both packages are MIT-licensed and published from their named GitHub repositories. `pi-blackhole@0.4.7` carries npm provenance attestation and targets Pi `>=0.81.1 <1.0.0`. `pi-hermes-memory@0.9.6` targets Pi `>=0.80.1` and depends on native `better-sqlite3`; installation must fail visibly if that native dependency cannot install.

### Disable the unsupported Apple plugin

Set `plugins.apple-tools.enabled` to `false` through the Dashboard plugin toggle route. Apple Tools requires macOS 15.3 or later, iMCP.app, and manual Apple permission grants. This Linux host cannot satisfy its path requirement.

### Correct the OpenSpec worktree-recovery skill at its source

Update `packages/openspec-workflow/.pi/skills/fix-worktree-opsx-skills-not-created/SKILL.md`. The repository now pins the real CLI and runs `pnpm install && npx --no-install openspec init --tools pi --force`; the skill's scoped-package command would bypass that pin. The installed OpenSpec CLI generated six lifecycle skills, so validation must check required names and the CLI's own success output instead of a hard-coded count of eight.

Update the existing `packages/openspec-workflow/AGENTS.md` row because it repeats the stale command. Validate the skill frontmatter and re-run the smallest recovery checks against this worktree. The installed npm copy remains unchanged; the feature branch carries the canonical source correction for the next package release.

### Link the clean Dashboard worktree into the global runtime

Run `npm link --ignore-scripts` from the repository root. The existing systemd unit starts the global `pi-dashboard` path. Replacing the global package directory with an npm-managed link keeps that path stable while making it resolve to the clean worktree.

Alternative: change the systemd unit. Rejected because it adds a second configuration mutation and is not needed.

Alternative: install the root package tarball globally. Rejected because the root package files include only the core source directories; plugin discovery needs the worktree `packages/*` tree.

### Restart without killing Pi sessions in the service cgroup

The user service has `KillMode=control-group`, and every active Pi process is in `pi-agent-dashboard.service`. A normal service restart would kill those processes. Add a named runtime-only systemd drop-in with `KillMode=process`, call `POST /api/shutdown` so the Dashboard announces a 60-second bridge quiesce window, wait for the old wrapper and server to exit, then start the service with the linked source. Remove that exact drop-in, reload the user manager, and verify `KillMode=control-group` after the new server is healthy.

`systemctl set-property` is not used because the running systemd rejects `KillMode` through that command. The supported path is `systemctl --user edit --runtime --stdin --drop-in=preserve-pi-sessions.conf`.

Alternative: call `POST /api/restart`. Rejected for this service layout because the wrapper main process exits cleanly and systemd can kill the replacement plus every Pi child when the unit stops.

Alternative: run `systemctl --user restart` directly. Rejected because it does not announce bridge quiescence and would kill the control group under the current property.

### Leave bridge conflicts unchanged

Inventory conflicts by comparing each worktree plugin bridge path with `settings.json#dashboardPluginBridges`. Existing paths remain on disk, so replacing them would change source ownership outside this dependency repair.

## Risks / Trade-offs

- [Risk] The global Dashboard link depends on this worktree remaining present. Mitigation: keep the dedicated worktree until review finishes; rollback with a published global Dashboard install if the worktree must be removed.
- [Risk] The four enabled bridge plugins retain load errors. Mitigation: report them separately and do not use those errors as dependency-validation failures.
- [Risk] Blackhole changes compaction behavior and pi-vcc cannot remain loaded. Mitigation: remove the exact pi-vcc source first and stop if removal fails.
- [Risk] Hermes Memory overlaps with two installed memory systems and adds background LLM work plus a native SQLite dependency. Mitigation: record the user's explicit opt-in, install through Pi, and surface any install failure without a retry or substitute.
- [Risk] The installed OpenSpec workflow package remains stale until the repository package is released and reinstalled. Mitigation: update the canonical source, validate it, and report the unsynchronized installed copy.
- [Risk] The shutdown/start window can briefly disconnect this session. Mitigation: use the Dashboard shutdown announcement, preserve non-main service processes with runtime-only `KillMode=process`, and verify this session reappears with `hidden: false`.
- [Risk] A failed start could leave the temporary `KillMode=process` drop-in in place. Mitigation: the activation script removes only `preserve-pi-sessions.conf` after success or failure, reloads systemd, and reports the final effective value.

## Migration Plan

1. Verify `pi list` and the producer package metadata.
2. Verify the worktree build and plugin registry contain the `subagents` plugin.
3. Run `npm link --ignore-scripts` from this worktree.
4. Add runtime-only drop-in `preserve-pi-sessions.conf` with `KillMode=process` and verify the effective value.
5. Call `POST http://localhost:8147/api/shutdown` to announce quiescence and stop the old server.
6. Wait for port `8147` to become free, then start `pi-agent-dashboard.service`.
7. Wait for version `0.7.0` to report healthy, remove the named runtime drop-in, reload systemd, and verify `KillMode=control-group`.
8. Disable Apple Tools through `POST /api/plugins/apple-tools/toggle`.
9. Remove `npm:@sting8k/pi-vcc`; install `npm:pi-blackhole` and `npm:pi-hermes-memory` through Pi; stop on any failure.
10. Reload connected sessions once.
11. Restart the Dashboard with the same session-preserving systemd procedure so plugin status and requirements refresh.
12. Read `GET /api/plugins`; require an empty union of `missingRequirements` for enabled plugins.
13. Correct and validate the canonical OpenSpec worktree-recovery skill and its purpose row.
14. Verify this session remains visible.
15. If activation fails, restore `KillMode=control-group`, restore the prior package set where safe, and start the Dashboard service.
