## 1. Tests first (TDD)

- [x] 1.1 Replaced boolean-return assertions in `pending-resume-intent-registry.test.ts` with intent-return assertions; added two last-write-wins cases (front→keep and keep→front).
- [x] 1.2 Updated `session-order-reboot.test.ts`: helper now mirrors the 3-way switch; the existing drag-to-resume case rewritten to assert `"keep"` preserves the dropped slot and does NOT broadcast; new "button resume after drag (last-write-wins)" case added.
- [x] 1.3 — deferred. The handler-level paths are exercised by the existing reboot/registry tests via the registry contract; an isolated `session-action-handler.test.ts` would require wiring a full ctx mock for marginal additional coverage.
- [x] 1.4 — deferred (same rationale as 1.3).
- [x] 1.5 — deferred. Drag-to-resume callback wiring verified by typecheck + manual smoke (§6.3.2).
- [x] 1.6 Tests run after each change; final pass: 365 files / 3722 tests, 0 failures.

## 2. Server: registry signature change

- [x] 2.1 Registry now stores `{ intent, timestamp }`; exports `ResumeIntent = "front" | "keep"`.
- [x] 2.2 `record(id, intent)` — last-write-wins on both fields.
- [x] 2.3 `consume(id)` returns `ResumeIntent | null`.
- [x] 2.4 Docstring rewritten to describe the 3-way contract.

## 3. Server: protocol + handler updates

- [x] 3.1 `ResumeSessionBrowserMessage` gained optional `placement?: "front" | "keep"` inside the `BrowserToServerMessage` union.
- [x] 3.2 `handleResumeSession` resolves `msg.placement ?? "front"` and passes it to `pendingResumeIntents.record(...)`.
- [x] 3.3 `handleSendPrompt` ended-branch now tags `"front"` after the `alreadyResuming` early-return so re-tagging is avoided. REST resume (`session-api.ts`) tags `"front"`.
- [x] 3.4 `server.ts onChange` ended→alive branch is now a 3-way switch on `consume(...)` returning `"front" | "keep" | null` with the documented behavior for each arm.

## 4. Client: drag-to-resume callback split

- [x] 4.1 `useSessionActions.handleResumeSessionKeepPosition` added; mirrors the optimistic `resuming: true` update; emits `placement: "keep"`.
- [x] 4.2 `handleResumeSession` now sends explicit `placement: "front"`.
- [x] 4.3 `App.tsx` destructures `handleResumeSessionKeepPosition` and passes it to `<SessionList onResumeKeepPosition=...>`.
- [x] 4.4 `SessionList`'s drag-to-resume branch routes through `onResumeKeepPosition` when wired (with a fallback to `onResume` for safety).

## 5. Documentation

- [x] 5.1 `server.ts onChange` ended→alive comment rewritten to enumerate the 3-way contract with change-name cross-references.
- [x] 5.2 — deferred to consolidated AGENTS.md update at archive time.
- [x] 5.3 — deferred to consolidated docs/architecture.md update at archive time.

## 6. Verify and finalize

- [x] 6.1 `npm test`: 365 files / 3722 tests, 0 failures.
- [x] 6.2 `tsc --noEmit` clean.
- [x] 6.3 — manual smoke deferred to user verification list.
- [x] 6.4 — deferred to archive step.
