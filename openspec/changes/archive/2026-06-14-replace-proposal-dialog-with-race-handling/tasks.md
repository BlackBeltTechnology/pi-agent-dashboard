# Tasks: replace-proposal-dialog-with-race-handling

## 1. Shared types and protocol

- [x] 1.1 Add `pendingReplaceProposal?: string | null` and `rejectedReplaceProposals?: string[]` to `DashboardSession` in `packages/shared/src/types.ts`.
- [x] 1.2 Add browser→server message types `accept_replace_proposal { sessionId, changeName }` and `dismiss_replace_proposal { sessionId, changeName }` in `packages/shared/src/browser-protocol.ts`.
- [x] 1.3 Update any TS unions / type-guards consuming the above (search for places that exhaustively switch on browser message `type`).

## 2. Server: coalescing logic in event-wiring

- [x] 2.1 In `packages/server/src/event-wiring.ts`, add an `else` to the existing `if (attachmentWasAutoTracked && differentChangeDetected)` block (~line 330): manual attachment (`!isNameAutoSetFromAttachment(updatedSession)`) + `detected.isActive` + `changeName !== attachedProposal` + `changeName !== pendingReplaceProposal` + `changeName ∉ rejectedReplaceProposals` → set `pendingReplaceProposal = changeName`, broadcast `sessionUpdated`.
- [x] 2.2 In the same branch, when `pendingReplaceProposal` is already set and the new `changeName` differs (and is not rejected), overwrite `pendingReplaceProposal` and re-broadcast (coalesce, latest wins).
- [x] 2.3 In the same branch, when the new `changeName` equals current `pendingReplaceProposal`, no-op (no broadcast, no state change).
- [x] 2.4 Add deleted-proposal bypass: if `attachedProposal` is set but the OpenSpec poller no longer lists it, treat as if no proposal were attached and auto-attach via the existing path. Reuse the in-memory poll cache; do NOT trigger a new poll.
- [x] 2.5 In the existing `agent_end` handler (~line 353, where `openspecPhase`/`openspecChange` are cleared), additionally clear `pendingReplaceProposal` and `rejectedReplaceProposals`. Broadcast `sessionUpdated`.
- [x] 2.6 Mirror the `agent_end` clear in any session abort/end path (search for places that clear `openspecPhase`).

## 3. Server: accept / dismiss handlers

- [x] 3.1 In `packages/server/src/browser-handlers/session-meta-handler.ts`, add handler for `accept_replace_proposal`: validate `changeName` matches `pendingReplaceProposal` OR `attachedProposal` (defensive); reuse the existing `applyAttachProposal(sessionId, changeName, ctx)` helper (line 47 — it already sets `attachedProposal`, runs `attachRenameTarget`, sends `rename_session`, broadcasts `sessionUpdated`, and is idempotent); then clear `pendingReplaceProposal`; do NOT add to `rejectedReplaceProposals`.
- [x] 3.2 Add handler for `dismiss_replace_proposal`: append `changeName` to `rejectedReplaceProposals` (dedup), clear `pendingReplaceProposal`, broadcast `sessionUpdated`.
- [x] 3.3 Wire both handlers into the browser gateway dispatcher `switch` in `packages/server/src/browser-gateway.ts` (~line 432, alongside `case "attach_proposal"`), and add the imports to the existing `session-meta-handler.js` import (line 71).

## 4. Server tests

- [x] 4.1 Test: manual attachment + new active changeName → `pendingReplaceProposal` set, broadcast emitted.
- [x] 4.2 Test: same changeName fires twice → only one broadcast.
- [x] 4.3 Test: changeName A then B (both new) → `pendingReplaceProposal` overwrites A→B with two broadcasts.
- [x] 4.4 Test: dismiss B → `rejectedReplaceProposals` contains B, subsequent B events no-op.
- [x] 4.5 Test: dismiss B then C arrives → C surfaces as new `pendingReplaceProposal` (rejection is per-name).
- [x] 4.6 Test: `agent_end` clears both `pendingReplaceProposal` and `rejectedReplaceProposals`; subsequent B events re-prompt.
- [x] 4.7 Test: `accept_replace_proposal` attaches the named change, runs auto-rename, clears pending, broadcasts.
- [x] 4.8 Test: `accept_replace_proposal` with a name that does not match `pendingReplaceProposal` is rejected (defensive check).
- [x] 4.9 Test: deleted-proposal bypass — `attachedProposal=X`, poller does not list X, new event for Y → auto-attaches Y silently (no `pendingReplaceProposal`).
- [x] 4.10 Test: `isActive=false` events never set `pendingReplaceProposal`.

## 5. Client: dialog component

> **Dependency:** build on the shared `Dialog` shell from `unify-dialog-system` (custom body, NOT the `Confirm` preset — the banner/committedTarget logic needs the shell). If that change has not landed, sequence this after it or implement against its `Dialog` primitive contract. Do NOT hand-roll a new one-off dialog.

- [x] 5.1 Extend `packages/client/src/components/SessionOpenSpecActions.tsx` (it already imports `Confirm` from `@blackbelt-technology/pi-dashboard-client-utils/Confirm`). Use `Confirm` with its `body?: ReactNode` slot to render the divergence banner above the message.
- [x] 5.2 Component renders when `session.attachedProposal != null && session.pendingReplaceProposal != null`.
- [x] 5.3 Local state: `committedTarget: string` initialised from `session.pendingReplaceProposal` on first render (use `useState` lazy initialiser keyed by `session.id`).
- [x] 5.4 If `session.pendingReplaceProposal !== committedTarget`, render banner inside the `Confirm` `body` slot: "Newer change detected: `<pendingReplaceProposal>`. [Use latest]". Banner is dismissible only via `[Use latest]` (sets `committedTarget := pendingReplaceProposal`).
- [x] 5.5 `Confirm`'s `confirmLabel` reads `"Replace with <committedTarget>"` (primary intent); cancel uses the default `"Cancel"`.
- [x] 5.6 `[Replace]` sends `{ type: "accept_replace_proposal", sessionId, changeName: committedTarget }`. `[Cancel]` and Esc send `{ type: "dismiss_replace_proposal", sessionId, changeName: committedTarget }`.
- [x] 5.7 When `session.pendingReplaceProposal` becomes null (server cleared it after accept/dismiss/`agent_end`), unmount the dialog.

## 6. Client tests

- [x] 6.1 Test: dialog renders when both attached and pending are set.
- [x] 6.2 Test: button text shows the committed target, not the latest suggestion (the core invariant).
- [x] 6.3 Test: divergence shows banner; click `[Use latest]` updates committed target.
- [x] 6.4 Test: Replace click sends `accept_replace_proposal` with the *committed* target.
- [x] 6.5 Test: Cancel / Esc sends `dismiss_replace_proposal` with the *committed* target.
- [x] 6.6 Test: dialog unmounts when `pendingReplaceProposal` becomes null.
- [x] 6.7 Test: switching sessions while a dialog is open mounts a fresh dialog state for the new session (lazy init keyed by session id).

## 7. Documentation

- [x] 7.1 Update `docs/file-index-server.md` row for `event-wiring.ts` with caveman-style annotation: "See change: replace-proposal-dialog-with-race-handling — pendingReplaceProposal coalescing branch."
- [x] 7.2 Update `docs/file-index-server.md` row for `session-meta-handler.ts` with the new accept/dismiss handlers.
- [x] 7.3 Update `docs/file-index-client.md` row for the chosen dialog file.
- [x] 7.4 If the dialog is a new file, add a row in `docs/file-index-client.md` in path-alphabetical order.
- [x] 7.5 Delegate ALL `docs/` writes to a general-purpose subagent per AGENTS.md "Documentation Update Protocol", passing the caveman-style rule verbatim.

## 8. Verification

- [x] 8.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm all tests pass. (All change-related tests pass. Remaining failures are pre-existing/unrelated: image-fit jimp dependency errors, and load-sensitive real-server integration tests that pass in isolation.)
- [x] 8.2 Type-check verified: changed server + client files compile clean against worktree-local shared (0 errors). NOTE: full `npm run reload:check` requires a live dashboard with connected pi sessions — operational step for the user; worktree tsc resolves `shared` to the main repo (develop) so a bare `tsc` shows false "field missing" errors.
- [ ] 8.3 Manual smoke test: attach proposal A; ask the LLM to write to `openspec/changes/B/`; confirm dialog appears; ask for another write to `openspec/changes/C/`; confirm banner appears; click `[Use latest]`; confirm button text now says C; click `[Replace]`; confirm session is now attached to C with auto-rename applied.
- [ ] 8.4 Manual rejection-memory test: attach A; LLM writes to B; dismiss; LLM writes to B again → no dialog; LLM writes to C → dialog reappears for C.
- [ ] 8.5 Manual `agent_end` clear: dismiss B; wait for `agent_end`; new turn writes to B → dialog reappears.
