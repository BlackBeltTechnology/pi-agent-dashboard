# Tasks

## Phase 1 — Constant + error wording

- [x] Change `SERVER_READY_DEADLINE_MS` in `packages/electron/src/lib/server-lifecycle.ts` from `60_000` to `15_000`.
- [x] Update `buildServerStartupError` (deadline-exceeded branch) wording from "Server did not respond within 60 seconds" to "Server did not respond within 15 seconds".
- [x] Update the contract test in `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts` so the pinned value is `15_000`. Keep the assertion that *every* `waitForReady` callsite passes `deadlineMs: SERVER_READY_DEADLINE_MS` (drift guard).

## Phase 2 — Drop double-retry, route to loading page

- [x] In `packages/electron/src/main.ts`, replace the `for (let attempt = 0; attempt < 2; attempt++)` loop with a single `ensureServer()` call.
- [x] On `ensureServer()` failure, classify the error:
  - Configuration / terminal errors (CLI not found, no TS loader, port conflict) → keep the existing error dialog (`Run Setup / Retry / Quit`).
  - Deadline-elapsed or child-exit errors → skip the dialog, fall through directly to `showLoadingPage(win, serverUrl)`.
- [x] Use the existing error-message prefixes ("Server did not respond within 15 seconds", "Server child process exited prematurely") emitted by `buildServerStartupError` to drive the classification.
- [x] Ensure the splash still closes before either the error dialog or the loading page is shown.

## Phase 3 — Tests

- [x] Add a unit test asserting `SERVER_READY_DEADLINE_MS === 15_000`.
- [x] Add a unit test for the error-classification helper (terminal vs. deadline / child-exit) — pure function over the error message string.
- [x] Run the full `npm test` suite; capture to `/tmp/pi-test.log` per AGENTS.md guidance and grep for failures.

## Phase 4 — Docs

- [x] Update the relevant row in `docs/file-index-electron.md` (if it carries a deadline annotation) to reflect the 15 s value.
- [x] No `AGENTS.md` change — the "Key Files" row for `server-lifecycle.ts` does not pin the deadline value.
