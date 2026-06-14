# Tasks

## 1. Confirm the design decision

- [x] 1.1 Decision locked: **P2** (keep `pollOne` pure; emit pending from the
  three broadcast wrappers via a shared `emitPendingIfDiscovered(cwd)` helper).
  See design.md.
- [x] 1.2 Verify `onChangeCallback` wiring timing on the `onDirectoryAdded`
  path — confirmed: `startPolling` wires the callback during bootstrap
  (`session-bootstrap.ts:68`), before any `session_register` triggers
  `onDirectoryAdded`. All `pollDirectoryGated` callers run with it wired.

## 2. Server: emit transitional pending from the poll path

- [x] 2.1 Failing test added
  (`directory-service-pending-emit.test.ts`): a poll for a cwd whose
  `openspec/changes/` exists but cache holds no `initialized` data emits the
  transitional `{ initialized:false, pending:true }` snapshot via
  `onChangeCallback` **before** the final `initialized` payload returns.
- [x] 2.2 Failing test added (Scenario 2): a cwd polled while
  `openspec/changes/` is absent emits no pending; once the dir is created the
  next gated poll emits `pending:true` then returns `initialized:true` (no
  straight jump).
- [x] 2.3 Implemented `emitPendingIfDiscovered(cwd)`: stats
  `openspec/changes/`; when it exists and cache is not yet `initialized`,
  broadcasts `pending:true` immediately before `pollOne` runs `openspec list`.
- [x] 2.4 Wired the emit at the single shared choke point
  `pollDirectoryGated` (refinement of P2). All three broadcast wrappers —
  periodic tick (`scheduleOpenSpecTick`), `onWatcherFired`, and the
  `onDirectoryAdded` service method — plus the safe post-bulk-archive refresh
  funnel through `pollDirectoryGated`, so one call covers every path with no
  risk of missing a site. `pollOne` stays pure. See design.md decision note.

## 3. Non-openspec + terminal-state safety

- [x] 3.1 Test added: a cwd with no `openspec/` dir is polled — no
  `pending:true` broadcast; payload stays `{ initialized:false, ... }`,
  `hasOpenspecDir:false`.
- [x] 3.2 Test added: a cwd with `openspec/` but no `changes/` subdir
  (init-only) is polled — `changesRoot` stat undefined, no `pending:true`
  emitted, `hasOpenspecDir:true`.
- [x] 3.3 Test added: `pending:true → initialized:false` terminal transition
  (CLI returns null) — final payload has `pending !== true`. Confirmed
  `FolderOpenSpecSection.tsx:42` resolves `!initialized` (and `!pending`) to
  `return null` (render nothing), clearing the spinner.

## 4. Spec + regression

- [x] 4.1 Spec delta already describes the poll-path pending emit; updated to
  note the single `pollDirectoryGated` choke point.
- [x] 4.2 Full suite run. New `directory-service-pending-emit.test.ts`: 5/5
  pass. The 19 remaining failures are pre-existing and unrelated
  (`pi-image-fit` jimp version mismatch; `doctor-route` + `event-wiring-source-
  stamp` fail identically with this change stashed). `tsc --noEmit` clean for
  `directory-service.ts`; the 7 type errors are the same unrelated jimp issue.
- [ ] 4.3 Manual verify both scenarios (requires a live dashboard + worktree
  spawn — not runnable headless here): (1) worktree off a parent with committed
  `openspec/` → spinner then content; (2) worktree with delayed `openspec init`
  hook → spinner appears when dir lands, then content. Automated tests 2.1/2.2
  cover both scenarios at the poll layer.
