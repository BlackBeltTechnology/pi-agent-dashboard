## 1. Shared Contract and Mutation Classifier

- [x] 1.1 Add failing shared tests for the case-insensitive Write/Edit/StrReplace, Bash/Shell/exec_command, and apply_patch mutation name set, including non-mutation exclusions.
- [x] 1.2 Add the minimal shared mutation name set/helper and export additive `FileOperationFailure` / `SessionDiffResponse.fileOperationFailures` types.
- [x] 1.3 Update nearest shared directory `AGENTS.md` rows for any new source or test files.

## 2. Server Failure Correlation

- [x] 2.1 Add failing `session-diff` tests for a changed Write/Edit/StrReplace path ending with matching `isError: true`, plus an unrelated-failure false-attribution guard.
- [x] 2.2 Add failing live/replay fixture tests for Codex `apply_patch` `partial_failure`, `isError` precedence, unknown-status rejection, structured applied versus failed-only paths, and deterministic duplicate end events.
- [x] 2.3 Add failing Shell/exec_command tests for output-token attribution and non-zero exits; add guards proving mtime-only proximity cannot attach a failure.
- [x] 2.4 Add failing tests for non-git StrReplace/apply_patch discovery, orphan/missing-id lifecycle events, empty-name/message fallback, cwd escapes, response cardinality caps, and `MAX_FILES` post-filtering.
- [x] 2.5 Implement lifecycle indexing and failure normalization by `toolCallId`, supporting live `result.content` / nested details and replay string / top-level details shapes.
- [x] 2.6 Implement exact candidate-path union, cwd normalization, final changed-set intersection, non-git evidenced-path discovery, deterministic deduplication, newest-first ordering, and cap filtering.
- [x] 2.7 Bound, redact, and sanitize failure messages and local path prefixes; omit raw args/details and failures with incomplete lifecycle or no correlated changed path.
- [x] 2.8 Extend `buildSessionDiff` and the existing REST response additively with `fileOperationFailures`.

## 3. Client Refresh and Changes UI

- [x] 3.1 Add failing client tests proving apply_patch, Shell, StrReplace, exec_command, and failed mutation results increment the diff refresh signal while Read/search do not.
- [x] 3.2 Replace the hardcoded Edit/Write/Bash refresh filter with the shared mutation classifier while preserving one-in-flight plus one-trailing refresh behavior.
- [x] 3.3 Add failing `DiffFileTree` tests for affected-file badges, accessible labels, one operation spanning multiple files, multiple failures on one file, empty omission, and failure-path selection.
- [x] 3.4 Render the `Failed operations` section and per-file failure badges from normalized `affectedPaths` without creating pseudo-files or a new viewer route.
- [x] 3.5 Add localized labels for failure count, section title, operation kind, and affected-file status.

## 4. Cross-Provider and Browser Verification

- [ ] 4.1 Extend the Docker Playwright tool-created-files scenario with captured Codex partial-patch and Grok failed-Shell event fixtures; assert retained files, failure text, badges, and diff opening.
- [x] 4.2 Verify equivalent live and replay fixture streams produce the same session-diff failure payload.
- [x] 4.3 Verify sessions containing only non-file provider/tool errors show no Failed operations section in Changes.

## 5. Documentation and Quality Gates

- [x] 5.1 Update `docs/architecture.md` through a delegated docs subagent with the tool lifecycle correlation and additive response field; update affected directory `AGENTS.md` rows in caveman style.
- [x] 5.2 Run targeted shared, server, and client tests; capture full output once and inspect failures from the saved log.
- [ ] 5.3 Run `npm run quality:changed` and the advisory CodeRabbit uncommitted-diff gate; fix actionable findings.
- [ ] 5.4 Run the local-change Docker Playwright scenario with guaranteed teardown and record any environment-only manual follow-up.
