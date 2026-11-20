## 1. #1136 Image-only send (tests first)
- [ ] 1.1 Add failing tests in `packages/client/src/components/__tests__/CommandInput.test.tsx`: image-only click/Enter/Alt+Enter calls `onSend("", images, delivery)` and clears; send button enabled with images only; empty+no images still blocked; `allowImageOnlySend={false}` blocks.
- [ ] 1.2 Add failing test for `ExploreDialog` (image-only enabled, `onSend("", images)`; empty still disabled) and `DirectoryHomeView` (image-only spawns nothing).
- [ ] 1.3 Add failing tests in `packages/extension/src/__tests__/`: `buildUserMessageContent("", [img])` → `[img]`; text+image unchanged; empty text + invalid image → `""`; followup-drain image-only.
- [ ] 1.4 Implement: `CommandInput.handleSend` guard + button `disabled` use `!trimmed && pendingImages.length === 0` (new prop `allowImageOnlySend`, default true); `ExploreDialog` guard + button; `DirectoryHomeView` passes `allowImageOnlySend={false}`; `buildUserMessageContent` omits empty text block.
- [ ] 1.5 Verify chat rendering of an image-only user bubble (optimistic `pendingPrompt` with `text:""`, committed message, queue chip) shows the image and no blank text row; fix if not.

## 2. #1116 Inline Other replaces own Other (after confirming DECISIONS Q1)
- [ ] 2.1 Update `packages/shared/src/__tests__/prompt-answer.test.ts`: `isOtherAllowed` true for opted-in options containing `"Other (describe)"`; `isOwnOtherOption` matches/non-matches; `validateQuestionAnswer` accepts custom text there and still accepts the literal option; non-opted-in unchanged.
- [ ] 2.2 Update renderer tests (`SelectRenderer`, `MultiselectRenderer`, `BatchRenderer`): own-Other hidden, inline row shown, typed text is the answer; non-opted-in keeps own Other as a normal option.
- [ ] 2.3 Implement `isOwnOtherOption` + drop `!hasOwnOtherOption` clause in `packages/shared/src/prompt-answer.ts`; filter own-Other options in the three renderers.
- [ ] 2.4 Check `ask_user` tool description/prompt text (`ask-user-tool.ts`) does not tell the model to add its own "Other"; adjust only if it does.

## 3. #1117 Prompt draft persistence
- [ ] 3.1 Failing tests `packages/client/src/lib/__tests__/prompt-draft-storage.test.ts`: key naming, round-trip, debounce, size cap, corrupt/wrong-version ignored, TTL sweep, per-session delete, images map memory-only.
- [ ] 3.2 Failing renderer tests: Select/Multiselect Other + checks, Input text (+images), Batch step/answers/otherDraft restored after unmount/remount with same `sessionId`+`requestId`; not restored for another prompt/session; cleared on respond/cancel/non-pending; stale batch shape discarded; restored Other ignored when no longer allowed.
- [ ] 3.3 Add optional `promptId` to `QuestionRow` (`packages/shared/src/question-types.ts`) and the row projection in `packages/server/src/questions/question-store.ts` (+ server test); confirm chat `requestId` === store `promptId` in the gateway hook.
- [ ] 3.4 Implement `lib/state/prompt-draft-storage.ts` and `usePromptDraft(sessionId, promptId)`; add optional `sessionId` to `InteractiveRendererProps`; pass it from `ChatView.tsx`, `MultiAskPanel.tsx`, `QuestionDialog.tsx` (dialog uses `detail.sessionId` + `detail.promptId`).
- [ ] 3.5 Wire renderers (`Select`, `Multiselect`, `Input`, `Batch`) to init from and write to the draft; clear on respond/cancel/status change.
- [ ] 3.6 Sweep: delete a session's `ask-draft:*` entries where `App.tsx` removes session drafts (~`:1740`); TTL sweep at hydrate. Add test.
- [ ] 3.7 Add/refresh `*.AGENTS.md` rows for new files (main agent edits source-tree rows under `packages/`).

## 4. Verify and land
- [ ] 4.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep verdict; `npm run quality:changed`.
- [ ] 4.2 Extension change → `npm run reload`; server/shared change → `npx tsx .pi/skills/implement/scripts/restart-server.ts`; client change → `npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`; `curl -s http://localhost:8000/api/health | jq .mode`.
- [ ] 4.3 Manual: image-only send in chat + Explore; Other typed → switch session → back → reload; batch half-filled; dialog ↔ card share.
- [ ] 4.4 Run `review-code`; docs via DocScribe if `docs/` prose is needed (main agent does not edit `docs/`).
- [ ] 4.5 `npx openspec validate fix-input-state-consistency --strict`.
