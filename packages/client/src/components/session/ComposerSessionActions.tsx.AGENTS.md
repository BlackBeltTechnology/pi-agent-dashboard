# ComposerSessionActions.tsx — index

OpenSpec lane of the composer dock. Split out of the former composer strip; the file keeps the readiness gate and `showTrace`.

- `useOpenSpecAttachment(session, changes)` → `{attached, resolution, change, changeState, showTrace}`; one computation shared with the Merge-emphasis rule in `useComposerDockLanes`.
- `isOpenSpecLaneVisible({isEnded,showTrace,openspecReadiness,openspecHasDir,openspecPending})`: READY/PENDING (else `hasDir !== false || pending`) while not ended, or any traceable attachment.
- `useOpenSpecLane(input)` → `DockLane` (`testId` `composer-openspec-container`). Unattached: title `OpenSpec`, not expandable, actions Attach change… / Explore / `⋯` (New·Propose per workflow config + Refresh). Attached: title name, meta `done/total tasks`, actions = lifecycle bar (letters) + one primary + `⋯`; `⋯` = same `deriveOpenSpecActions` items as the session card (`includeDetach:true`) + Open proposal + Refresh before Detach. Traceable (archived / missing / main checkout): `AttachmentTrace` + `⋯` with Detach only; no bar or primary.
- Working (streaming ∨ retrying): primary, `⋯` workflow items, Explore `aria-disabled` + focusable with reason; Tasks segment inert; P/D/S, Open proposal, Attach, Detach, Refresh stay live.
- `mergeIsPrimary` (decided once per dock) outlines this lane's primary.
- Expanded body `OpenSpecTasksBody`: `fetchTasks(cwd, change)` on expand, cache per change keyed by `done/total` (ref held by the lane hook), last done + next 5 open tasks with number and done/to-do shape, `N more · Open tasks.md`; failure = inline `Couldn't load tasks` + Retry + `Open tasks.md`.
- Dialogs (explore, new, propose, attach, archive confirms, tasks popover) live in `OpenSpecLaneActions`.

Attachment resolved via `useAttachmentResolution`. Passes `change.error?.message` to `deriveOpenSpecActions` (Continue/FF `aria-disabled`, title = message). `working` is `isComposerWorking(...)` from `App.tsx`. Removed with the strip: root `composer-session-actions`, change chip + popover (`composer-change-*`), Git and Status groups (now `ChangesLane.tsx` / `ContextLane.tsx`).

See changes: redesign-composer-session-strip, resolve-archived-attached-proposal, fix-composer-liveness-on-reload, use-openspec-status-all, add-composer-dock (tasks 5.1–5.3).
