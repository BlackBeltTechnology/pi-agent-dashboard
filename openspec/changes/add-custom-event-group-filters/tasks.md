## 1. Groups configuration file

- [ ] 1.1 Define the `CustomEventGroups` config types (`version`, ordered `groups[]` of `{ id, label, pattern, default }`, `seenShippedIds[]`) and the shipped defaults (memory `^om\.` default-hidden; search, subagents, flows, goals default-visible) in shared, and verify a unit test asserts the shipped defaults match the emitters listed in `proposal.md`
- [ ] 1.2 Implement the store for `~/.pi/dashboard/custom-event-groups.json` following the `tool-registry/overrides.ts` conventions (versioned envelope, lazy load, in-memory cache, atomic tmp+rename persist), and verify a test shows the file is created with shipped defaults when absent and `seenShippedIds` lists every shipped id
- [ ] 1.3 Implement load-time validation and fail-open (unparseable file or non-array `groups` → shipped defaults, file left untouched and failure logged; entry missing `id`, duplicate `id`, or missing/uncompilable `pattern` → that entry skipped, others retained), and verify tests cover each malformed case per the `Invalid group configuration SHALL fail open` scenarios
- [ ] 1.4 Synthesize the reserved `other` catch-all when the file omits it, and verify a test loading an `other`-less file still resolves unmatched types to `other`
- [ ] 1.5 Implement the `seenShippedIds` upgrade-merge (add a shipped group only when its id is absent from `seenShippedIds`; append merged groups after user-authored entries; always record the id), and verify tests cover new-group-added, deleted-group-stays-deleted across two loads, and append-after-user-rules ordering

## 2. Bounded pattern matching (design D3)

- [ ] 2.1 Add the `worker_threads` matcher worker that tests one `{ idx, pattern, customType }` per message and posts back `{ idx, matched }`, and verify a unit test round-trips a match and a non-match
- [ ] 2.2 Implement the main-thread driver: per-message timeout, `worker.terminate()` on expiry, quarantine the group at that index for the process lifetime, log it, respawn the worker and resume at the next index — and verify a test with a catastrophically-backtracking pattern completes rather than hanging, and that the offending group is the one quarantined
- [ ] 2.3 Verify a test asserts the worker is killed at most once per configured group per process (quarantine applied before resuming, so a file of pathological patterns cannot cause a respawn storm)

## 3. Group resolution

- [ ] 3.1 Implement `resolve(customType) → groupId` as first-match-wins over the ordered groups with `other` as fallback, skipping quarantined groups, and verify tests cover first-match-wins ordering (user rule before shipped rule) and the unmatched → `other` path
- [ ] 3.2 Memoize resolution per distinct `customType` for the process lifetime, and verify a test asserts the matcher is invoked at most once per distinct `customType` across repeated resolutions
- [ ] 3.3 Exclude `customType: "flow-event"` from resolution entirely, and verify a test asserts no group is returned for it and no matcher call is made

## 4. Server: annotation and exposure

- [ ] 4.1 Add `groupId` to the `custom_entry` protocol event and to custom `message_end` events in shared types, and verify typecheck passes across server and client
- [ ] 4.2 Tag `groupId` on the live custom-entry forwarding path and on custom messages, and verify a test asserts a forwarded `om.observations.recorded` event carries `groupId: "memory"`
- [ ] 4.3 Tag `groupId` on the replay path (`replayEntriesAsEvents`) so a reloaded session tags identically to live, and verify a test replays a session containing several custom types and asserts each row's `groupId` matches the live-path result
- [ ] 4.4 Expose the resolved group definitions (id, label, default, in resolution order — patterns NOT transmitted) to the client, and verify a test asserts the payload lists every configured group including `other` and omits `pattern`

## 5. Preferences plumbing

- [ ] 5.1 Add `customEventGroups: Record<string, boolean>` to `DisplayPrefs` in `packages/shared/src/display-prefs.ts`, remove `customEntryFallback`, and verify typecheck fails nowhere and every remaining reference is updated
- [ ] 5.2 Make `mergeDisplayPrefs` merge `customEventGroups` shallow field-by-field exactly like `toolCalls`, and verify a test asserts an override of one group id leaves every other group at the global value
- [ ] 5.3 Seed `customEventGroups` from the configured group defaults in `backfillDisplayPrefs` and in both `setDisplayPrefs` write paths, and verify a test asserts a legacy prefs file resolves each group to its configured default and never `undefined`
- [ ] 5.4 Add the `customEventGroups` deep-merge arm to `PATCH /api/preferences/display`, and verify a test asserts a PATCH of one group id preserves every other key and broadcasts `display_prefs_updated`
- [ ] 5.5 Add `customEventGroups` to all three presets and to `FirstLaunchDisplayModal`, and verify a test asserts every preset carries the field
- [ ] 5.6 Resolve an absent group id to that group's configured `default` rather than to hidden, and verify a test asserts a prefs object with no key for a configured group renders that group per its default

## 6. Migration (design D7)

- [ ] 6.1 Implement the one-shot `customEntryFallback → customEventGroups.other` migration over the global prefs and every per-session `displayPrefsOverride`, dropping the legacy field, and verify tests cover a persisted `false` landing as `other: false` globally and in a session override
- [ ] 6.2 Make the migration idempotent and non-destructive of an explicit user choice, and verify a test asserts a second load performs no further migration and does not overwrite an existing `customEventGroups.other`

## 7. Client rendering and surfaces

- [ ] 7.1 Replace the `customEntryFallback` gate at both `ChatView.tsx` sites (`isRowVisible`, render branch) with a `prefs.customEventGroups[row.groupId ?? "other"]` lookup, and verify a test asserts a hidden group's rows are excluded from row-visibility computation as well as from rendering
- [ ] 7.2 Treat a row arriving with no `groupId` as `other`, and verify a test asserts an un-annotated custom row renders under default prefs
- [ ] 7.3 Verify a test asserts groups are independently gated — hiding one group leaves rows of another group rendering — and that flow cards still render with every group toggled off
- [ ] 7.4 Render one toggle per configured group (including `other`, in configured order) in `SettingsPanel.tsx`, and verify a test asserts the list renders with no session selected
- [ ] 7.5 Render the same rows in `ChatViewMenu.tsx` with the existing per-session "overridden" indicator, and verify a test asserts toggling one group creates a session override affecting only that group
- [ ] 7.6 Remove the single "Custom entries in chat" row from both surfaces, and verify a test asserts it is absent and that its behavior is reachable via the `other` toggle

## 8. Verification and documentation

- [ ] 8.1 Run `npx openspec validate add-custom-event-group-filters --strict` and verify it reports valid
- [ ] 8.2 Run the full suite per AGENTS.md (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and verify no failures
- [ ] 8.3 Invoke the `security-hardening` discipline skill against the config-load and matcher paths (untrusted regex, malformed JSON, path handling) and verify findings are resolved or explicitly accepted
- [ ] 8.4 Invoke the `performance-optimization` discipline skill to measure that per-row render cost is unchanged and resolution cost is bounded by distinct `customType` count, and verify the measurement is recorded rather than assumed
- [ ] 8.5 Invoke the `doubt-driven-review` discipline skill on the `customEntryFallback` removal plus prefs migration before it lands, and verify the rollback path in `design.md` still holds
- [ ] 8.6 Delegate to DocScribe: add `custom-event-groups.json` to the `docs/architecture.md` config reference (noting restart-to-apply) and update the `~/.pi/dashboard/` file inventory, and verify the docs tree rows are applied
- [ ] 8.7 Add a CHANGELOG entry calling out that `om.*` memory telemetry now defaults to hidden, and verify the entry is under `## [Unreleased]`
- [ ] 8.8 Invoke the `review-code` discipline skill on the full diff before commit and verify findings are resolved
