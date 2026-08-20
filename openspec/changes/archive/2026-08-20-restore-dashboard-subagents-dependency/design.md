## Context

At task start, Pi settings already contained `npm:@blackbelt-technology/pi-dashboard-subagents`, but its package cache was incomplete. The live Dashboard process ran global Dashboard `0.6.1`, which discovered zero plugins because that install contained only the core `packages/{server,shared,extension}` source directories.

The clean worktree contains Dashboard `0.7.0`, 13 plugin manifests, and a generated production client bundle. Four plugin bridge paths conflict with existing live source paths. Those existing paths still exist, so the bridge registrar correctly refuses to replace them.

After activation, the newer plugin set exposed three requirements that were absent from the starting runtime: Apple Tools needs a macOS iMCP path, Blackhole needs `pi-blackhole`, and Hermes Memory needs `pi-hermes-memory`. The user first chose to disable Apple Tools, replace the installed pi-vcc package with Blackhole, and install Hermes Memory alongside the existing memory systems. A fresh Pi process then failed because Hermes registered `skill_manage`, which conflicts with the existing global `skill-manage.ts` extension. The user instructed Pi to remove the exact global source `npm:pi-hermes-memory`.

## Goals / Non-Goals

**Goals:**

- Make the live Dashboard use the clean worktree that contains the Subagent Inspector plugin.
- Preserve the existing Pi package declaration and installed package version.
- Restart through the Dashboard restart endpoint so connected sessions can reattach.
- Apply the user's activation choices for Apple Tools and Blackhole, then remove Hermes Memory after its fresh-start conflict.
- Prove that the Subagent Inspector dependency remains healthy and that Pi no longer lists the removed Hermes source.

**Non-Goals:**

- Change source code, dependency manifests, lockfiles, or API behavior.
- Replace existing bridge paths.
- Fix bridge path conflicts or other plugin load errors.
- Configure Blackhole or Hermes Memory beyond their package defaults.

## Decisions

### Reuse the installed Pi package

Do not run another install when `pi list` and the package metadata both resolve `@blackbelt-technology/pi-dashboard-subagents@0.2.4`. A second install adds network and package-manager risk without changing the result.

Alternative: run `pi update npm:@blackbelt-technology/pi-dashboard-subagents`. Rejected because the required package is already present and the requirement probe checks presence, not a newer version.

### Apply the package migration with Pi's package manager

Remove the exact configured source `npm:@sting8k/pi-vcc` before installing `npm:pi-blackhole`. Blackhole's upstream README states that standalone pi-vcc and Blackhole conflict because both own Pi's compaction hook.

Use Pi's package commands rather than editing `settings.json` or package-cache files. The earlier migration installed `npm:pi-hermes-memory`; after the fresh process reported the `skill_manage` conflict, run `pi remove npm:pi-hermes-memory`. Pi removal deletes the source from user settings but can leave package cache files. Do not manually delete them. Existing sessions can keep the already-loaded extension until they reload.

Package review: `pi-blackhole@0.4.7` is MIT-licensed, carries npm provenance attestation, and targets Pi `>=0.81.1 <1.0.0`.

### Make fresh Pi startup a hard global-mutation gate

Add `GLOBAL-PI-FRESH-START-001` to `~/.pi/agent/AGENTS.md`. After any global Pi package, extension, skill, prompt, theme, provider, or settings mutation, launch a new Pi process with normal extensions enabled. Require a prompt response within a short fixed deadline, then terminate the disposable process. A reload, `pi list`, or the already-running session does not satisfy the gate.

On startup failure, extension conflict, or deadline expiry before the response, roll back the global mutation and repeat the fresh-process check. Do not continue to commit, push, merge, or report completion while the gate is red.

### Disable the unsupported Apple plugin

Set `plugins.apple-tools.enabled` to `false` through the Dashboard plugin toggle route. Apple Tools requires macOS 15.3 or later, iMCP.app, and manual Apple permission grants. This Linux host cannot satisfy its path requirement.

### Correct the OpenSpec worktree-recovery skill at its source

Update `packages/openspec-workflow/.pi/skills/fix-worktree-opsx-skills-not-created/SKILL.md`. The repository hook runs `pnpm install && npx --no-install openspec init --tools pi --force`; manual recovery uses `pnpm exec openspec` so the lockfile-selected CLI cannot fall through to a registry fetch. Pin the scoped fallback to `@fission-ai/openspec@1.6.0`. The installed CLI generated six lifecycle skills, so validation must check required names and the CLI's own success output instead of a hard-coded count of eight.

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

### Keep auto-start tests independent of checkout type

The full suite fails from a Git worktree because two legacy `makeDeps` helpers omit the existing `resolveCliPath` test seam. They therefore resolve this worktree's real server CLI, trigger the production shared-port refusal, and never reach mocked `launchServer`. Inject a non-worktree host CLI path in those two helpers. The dedicated `server-auto-start-guarded.test.ts` suite continues to test both worktree refusal and host behavior explicitly.

### Remove a filesystem timestamp assumption from the KB test

`frontmatter-indexing.test.ts` rewrites one file and immediately runs incremental indexing. A fast filesystem can assign the same mtime to both writes, so the indexer correctly skips the file and the stale-property assertion fails. Pass `force=true` on the second index. This keeps the test focused on replacing stale property rows, while separate indexer tests own change detection.

### Drain the ChatView virtualizer callback before jsdom teardown

TanStack Virtual's element-offset observer debounces a scroll-reset callback for `isScrollingResetDelay`, which defaults to 150 ms. Its cleanup removes listeners but does not clear that timer. The shared client test cleanup currently waits one 0 ms turn, so under full-suite load a delayed callback can dispatch into React after jsdom removes `window`.

Track ChatView mounting through the existing scroll-container layout shim so manual unmounts cannot erase the signal. For those tests only, wait 160 ms after cleanup. Keep fake-timer tests on the existing non-wait path. This adds no production behavior and avoids slowing unrelated client tests.

### Correct the stale CI troubleshooting procedure

The `ci-troubleshoot` skill points to root `scripts/list-recent-runs.ts` and `scripts/show-failed-run.ts`, but the helpers live under `.pi/skills/ci-troubleshoot/scripts/`. Correct those four paths and run them through the repository-pinned `pnpm exec tsx`. Validate `show-failed-run.ts` against failed run `32286916122` and require its run summary plus failed annotation.

### Ship and make future Pi sessions independent of the extension worktree link

Open a pull request from the fork branch to upstream `develop`. Run the integrated test and build gates, archive the OpenSpec change, wait for required CI and review, then squash-merge.

Use Pi package commands to replace the linked `packages/extension` source with `npm:@blackbelt-technology/pi-dashboard-extension@0.7.0`, then pass the bounded fresh Pi startup gate.

A test replacement of the global Dashboard root link with published `@blackbelt-technology/pi-agent-dashboard@0.7.0` started a healthy server with zero discovered plugins. The activation gate failed, so restore the known-good worktree link and require 13 discovered plugins. Keep this worktree while the server depends on it. Worktree removal needs a separately validated published server package.

## Risks / Trade-offs

- [Risk] The global Dashboard server link depends on this worktree remaining present. The published root `0.7.0` package discovered zero plugins during activation. Mitigation: retain the worktree link, require 13 plugins after restart, and defer worktree removal until a published server package passes that gate.
- [Risk] The four enabled bridge plugins retain load errors. Mitigation: report them separately and do not use those errors as dependency-validation failures.
- [Risk] Blackhole changes compaction behavior and pi-vcc cannot remain loaded. Mitigation: remove the exact pi-vcc source first and stop if removal fails.
- [Risk] Removing Hermes Memory makes the enabled Hermes Memory dashboard plugin report its extension requirement as missing, and existing sessions can retain the loaded extension until reload. Mitigation: verify the exact source is absent from `pi list`, do not present the plugin warning as a Subagent Inspector failure, and state the reload boundary.
- [Risk] A prompt-mode Pi smoke can keep background extension work alive after the response. Mitigation: treat the response marker as startup success, terminate the disposable process immediately, and enforce a short parent-side deadline.
- [Risk] A host-path test seam could hide worktree refusal regressions in legacy behavior tests. Mitigation: keep the dedicated guarded suite as the single explicit owner of host and worktree path cases.
- [Risk] Forced indexing could hide incremental change-detection failures. Mitigation: this test owns stale-property replacement only; keep change detection in the indexer test suite.
- [Risk] A 160 ms cleanup wait can slow ChatView tests. Mitigation: apply it only when the test mounted the ChatView scroll container and skip it under fake timers.
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
9. Remove `npm:@sting8k/pi-vcc`; install `npm:pi-blackhole` and the initially approved `npm:pi-hermes-memory` through Pi; stop on any failure.
10. Reload connected sessions once.
11. Restart the Dashboard with the same session-preserving systemd procedure so plugin status and requirements refresh.
12. Read `GET /api/plugins`; require an empty union of `missingRequirements` for enabled plugins at this initial validation point.
13. Correct and validate the canonical OpenSpec worktree-recovery skill and its purpose row.
14. Verify this session remains visible.
15. After the user's reversal, remove `npm:pi-hermes-memory` through Pi and verify it is absent from `pi list`. Do not reload sessions or delete cache files as part of the removal.
16. Add the global fresh-start gate, then launch a disposable Pi process with normal extensions and require its response marker before the deadline.
17. Accept the resulting Hermes Memory plugin requirement warning while confirming the Subagent Inspector requirement remains healthy.
18. Replace the Pi extension worktree source with published `@blackbelt-technology/pi-dashboard-extension@0.7.0` and pass the bounded fresh Pi startup gate.
19. Test the published Dashboard root package. If it discovers zero plugins, restore the worktree link and require 13 plugins after restart.
20. Inject a host CLI path into the two legacy auto-start test helpers and pass their targeted tests.
21. Force the KB stale-property test's second index and pass its targeted suite.
22. Drain the TanStack Virtual scroll-reset callback after ChatView tests and pass the client plus full-suite gates.
23. Correct and validate the CI troubleshooting skill's first-move commands.
24. Integrate `origin/develop`, pass the full test and build gates, archive the change, open a PR, and merge only after CI and review pass.
25. Keep the worktree while the Dashboard server link resolves inside it.
26. If activation fails, restore `KillMode=control-group`, restore the prior package set where safe, and start the Dashboard service.
