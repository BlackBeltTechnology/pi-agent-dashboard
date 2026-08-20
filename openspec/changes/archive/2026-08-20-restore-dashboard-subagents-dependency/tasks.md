## 1. Verify the runtime dependency

- [x] 1.1 Confirm the worktree branch and base commit.
- [x] 1.2 Confirm `pi list` resolves `npm:@blackbelt-technology/pi-dashboard-subagents`.
- [x] 1.3 Confirm the installed producer package is `@blackbelt-technology/pi-dashboard-subagents@0.2.4` with its extension entry present.
- [x] 1.4 Install the worktree dependencies with the frozen lockfile and build the production client bundle.

## 2. Inventory unrelated plugin errors

- [x] 2.1 Compare worktree bridge paths with `settings.json#dashboardPluginBridges`.
- [x] 2.2 Record each path conflict without changing either path.

## 3. Activate the clean Dashboard source

- [x] 3.1 Link the clean worktree root into the global npm installation without lifecycle scripts.
- [x] 3.2 Temporarily set runtime-only `KillMode=process`, announce Dashboard shutdown, start the linked service, wait for version `0.7.0`, and restore `KillMode=control-group`.

## 4. Apply the approved plugin choices

- [x] 4.1 Disable Apple Tools through the Dashboard plugin toggle route.
- [x] 4.2 Remove the configured `npm:@sting8k/pi-vcc` package.
- [x] 4.3 Install `npm:pi-blackhole` and verify Pi resolves it.
- [x] 4.4 Install `npm:pi-hermes-memory` and verify Pi resolves it. Historical step; superseded by task 7.2 after the user reversed this choice.
- [x] 4.5 Reload connected Pi sessions once after the package migration.
- [x] 4.6 Restart the Dashboard with the session-preserving systemd procedure and verify `KillMode=control-group` is restored.

## 5. Correct the OpenSpec recovery skill

- [x] 5.1 Update the canonical recovery skill with the repository-pinned init command and name-based validation.
- [x] 5.2 Update the existing `packages/openspec-workflow/AGENTS.md` purpose row.
- [x] 5.3 Validate the corrected skill and record the installed-copy synchronization limit.

## 6. Validate and deliver

- [x] 6.1 Verify every enabled plugin reports an empty `missingRequirements` list.
- [x] 6.2 Verify `@blackbelt-technology/pi-dashboard-subagents@0.2.4`, `pi-blackhole`, and `pi-hermes-memory` remain in `pi list`, and pi-vcc is absent. Historical validation; the Hermes assertion is superseded by task 7.3.
- [x] 6.3 Verify this session remains visible with `hidden: false`.
- [x] 6.4 Validate the OpenSpec change and confirm no application source, manifest, lockfile, or active documentation changed outside the scoped skill correction.
- [x] 6.5 Close Bead `pidash-dwt`, commit the scoped files, push the feature branch, and push Beads.

## 7. Remove Hermes Memory after the user's reversal

- [x] 7.1 Update the proposal, design, and tasks before the runtime mutation.
- [x] 7.2 Remove the exact global Pi source `npm:pi-hermes-memory` without manually deleting cache files or reloading active sessions.
- [x] 7.3 Verify `pi list` no longer contains `npm:pi-hermes-memory` and the Subagent Inspector package remains present.
- [x] 7.4 Add `GLOBAL-PI-FRESH-START-001` to user-scope agent guidance and pass a bounded fresh Pi startup with normal extensions.
- [x] 7.5 Validate the revised OpenSpec change, close Bead `pidash-7o7`, commit, and push the branch and Beads.

## 8. Ship and make future Pi sessions independent of the extension worktree link

- [x] 8.1 Replace the linked Pi extension with published `0.7.0` and pass the bounded fresh-start gate. Test the published Dashboard root; after it discovers zero plugins, restore the server worktree link and verify 13 plugins.
- [x] 8.2 Inject a host CLI path into the two legacy auto-start test helpers and pass their targeted tests from this worktree.
- [x] 8.3 Force the KB stale-property test's second reindex and pass its targeted suite.
- [x] 8.4 Drain the TanStack Virtual scroll-reset callback after ChatView tests and pass the client plus full-suite gates.
- [x] 8.5 Correct the CI troubleshooting skill's deleted-script commands and validate skill frontmatter.
- [x] 8.6 Merge `origin/develop` into the branch and pass the full repository test and build gates.
- [x] 8.7 Pass fresh review, validate archive readiness, and hand the completed change to the repository ship pipeline.
- [x] 8.8 Track ChatView mounting across manual unmounts and retain the scoped 160 ms cleanup drain.
- [x] 8.9 Replace unpinned skill commands with repository-local `pnpm exec` calls and pin the registry fallback.
- [x] 8.10 Align the CI skill overview and reference taxonomy with the current workflow inventory.
- [x] 8.11 Make the OpenSpec recovery verification fail closed and prove it preserves Git status.
- [x] 8.12 Resolve the archive-location review as a false positive using the repository ship gate.

## 9. Address project-owner and final CodeRabbit feedback

- [x] 9.1 Restore release recovery commands and the no-manual-publish warning.
- [x] 9.2 Restore `_electron-build.yml` input semantics, especially `legs` and `source_only_bundle`.
- [x] 9.3 Restore literal failure-message-to-fix rows with current job names and the builder-debug drop-step guidance.
- [x] 9.4 Restore the post-release site update symptom and workflow checks.
- [x] 9.5 Restore all three KB sidecar pointers, run `kb dox lint`, and prove no lint finding targets those pointers; report unrelated baseline findings separately.
- [x] 9.6 Use “reusable workflows” consistently in both index records.
- [x] 9.7 Make worktree recovery reject dirty state, check final status retrieval, and update `.pi/settings.json` to the local scoped OpenSpec CLI.
- [x] 9.8 Record the single-virtualizer invariant, stack trace, `pool:"forks"` blame rotation, and bounded test cost in the authoritative AGENTS row.
- [x] 9.9 Clarify the root OpenSpec rule as creation-only; completed changes archive through `ship-change`.
- [x] 9.10 Persist the global rule that this agent never merges or enables auto-merge, then pass a fresh Pi startup.
- [x] 9.11 Obtain independent cautious review and synthesis proving every Robert and CodeRabbit item is addressed.
- [x] 9.12 Push only after task 9.11 passes; leave PR 520 unmerged for the owner.
