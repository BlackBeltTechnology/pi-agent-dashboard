# Tasks

## 1. Provenance + preference plumbing (shared/server)

- [x] 1.1 Add `nameSource?: "auto" | "user"` to `SessionMeta` (`packages/shared/src/session-meta.ts`) with docstring. → verify: `tsc --noEmit`.
- [x] 1.2 Add `autoNameSessions: boolean` (default `true`) to the preferences shape + `preferences-store.ts` read/write/default. → verify: unit test for default-when-absent.
- [x] 1.3 Relay `autoNameSessions` to bridges via the existing config-push path. → verify: bridge receives it on connect + on change.
- [x] 1.4 Extend `session_name_update` (or the rename path) so provenance is recorded: server tags `"user"` on browser-originated `rename_session`; bridge-reported auto/user provenance persisted to `.meta.json`. → verify: rename from dashboard writes `nameSource:"user"`.

## 2. In-process model call (extension)

- [x] 2.1 Acquire pi-ai's `streamSimple` inside the bridge the way the server does (`resolveModule("pi-ai")` / dynamic import). → verify: a smoke test calls it with a stub model.
- [x] 2.2 Helper `generateTitle(registry, modelRef, window)`: resolve model via `registry.find`, `getApiKeyAndHeaders`, call `streamSimple`, collect text. Mirror `packages/server/src/model-proxy/streamer.ts`. → verify: unit test with a fake registry + fake streamSimple yields the concatenated text.
- [x] 2.3 OAuth caveat: if the resolved model is OAuth-only and unauthable, return a hard-error result (no crash). → verify: unit test returns hard-error, not throw.

## 3. Naming module (extension)

- [x] 3.1 `agent_end` hook that runs the eligibility gate (`autoNameSessions` on · `nameSource!=="user"` · no auto-name yet). → verify: gate unit tests for each false branch.
- [x] 3.2 Pre-filter: greeting set / min-length / bare slash-command → skip without model call. → verify: unit tests for each skip case + a pass case.
- [x] 3.3 Resolve `@fast` via `lookupRole`; on unconfigured/OAuth-only → emit `auto_name_error` once, stop. → verify: unit test emits one error, sets hard-stop.
- [x] 3.4 Build the transcript window (first substantive user msg + first assistant reply, truncated) and `SUMMARIZER` system prompt. → verify: window builder unit test bounds size.
- [x] 3.5 Parse result: trim; `NULL`/empty/over-long → wait; else `pi.setSessionName(title)` + mark `"auto"` + stop. → verify: parse unit tests (valid / NULL / empty / too-long).
- [x] 3.6 Provenance latch: record the exact self-applied title; a later differing name the bridge didn't apply → mark `"user"`. → verify: state-machine unit test (auto → external change → user).

## 4. Error → toast (protocol/server/client)

- [x] 4.1 Add `auto_name_error { sessionId, reason }` to `protocol.ts` (bridge→server). → verify: `tsc --noEmit`.
- [x] 4.2 Server forwards `auto_name_error` to subscribers + logs one line. → verify: server test forwards + logs.
- [x] 4.3 Client toast on `auto_name_error` (one-shot per session). → verify: client test renders toast, no repeat on same session.

## 5. Settings UI

- [x] 5.1 Global `<ToggleField>` for auto-naming in the Settings panel, wired to `autoNameSessions`. → verify: toggling patches the preference.
- [x] 5.2 i18n keys for the label + toast copy.

## 6. Discipline checkpoints

- [x] 6.1 `doubt-driven-review` on the `nameSource` provenance state machine + self-vs-external detection before it stands.
- [x] 6.2 `security-hardening` pass: transcript window is bounded; no unintended secret-bearing content forwarded to the model.
- [x] 6.3 `observability-instrumentation`: `auto_name_error` reason + server log make "why unnamed" diagnosable.

## 7. Validate

- [x] 7.1 `openspec validate add-auto-session-naming --strict` passes.
- [x] 7.2 `npm test` green (new unit tests + no regressions).
- [x] 7.3 Manual: enabled fresh session on real work → auto-named once; greeting-only session → stays unnamed; manual rename → never auto-named; `@fast` unset → toast, no name.
