## Why

Three client input-handling defects, all in the composer / ask-user surfaces:

- [#1116](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1116) — the ask-user "Other" answer is inconsistent: inline row on some prompts, a plain "Other (describe)" option plus a second `input` prompt on others.
  - **PARTIAL.** The predicate is real: `isOtherAllowed` (`packages/shared/src/prompt-answer.ts:73-75`) returns false when `hasOwnOtherOption` (`:68-70`) matches, so an opted-in prompt (`allowOther: true`) that lists its own "Other…" gets two Others and a follow-up `input` round-trip. The `ask_user` tool defaults `allowOther` to true (`packages/extension/src/ask-user-tool.ts:400-401`, `:466-469`), and LLMs often add their own "Other (describe)" — this is the common case. Prompts WITHOUT `allowOther` (pi-flows branch selects, plugin `ctx.ui.select`) are unchanged **by design**: they route on an exact option (archived `add-ask-user-inline-other` D1, design.md:16-17, :43-44). The issue's "make every emitter pass `allowOther`" part is NOT done here — pi-flows is external and default-on was rejected in D1.
- [#1117](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1117) — partial ask-user answers are lost on session switch / reload.
  - **CONFIRMED.** All in-progress state is component-local `useState`: `SelectRenderer.tsx:20-21`, `MultiselectRenderer.tsx:18-22`, `InputRenderer.tsx:17-18`, `BatchRenderer.tsx:84-89` (`answers`, `step`, `otherDraft`). Switching session unmounts the card. No spec requires persistence (`interactive-renderers`, `pending-question-stack` are silent). The composer draft persists via `lib/state/draft-storage.ts` (`chat-draft:<sessionId>`).
  - Cross-surface sharing gap: `QuestionDialog.tsx:200-211` mounts the renderer with `requestId={detail.id}` (the question-store id), while chat card / panel use the prompt id (`ChatView.tsx:386-389`, `MultiAskPanel.tsx:38-45`). `QuestionRow` has no `promptId` (`packages/shared/src/question-types.ts:20-33`), so the dialog cannot compute the same key.
- [#1136](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1136) — image-only messages are blocked.
  - **CONFIRMED** (line numbers drifted). `CommandInput.tsx:605-607` `handleSend` returns on empty `trimmed`; `:883` button `disabled={… || !text.trim()}`. `ExploreDialog.tsx:30` `if (!text.trim()) return;`, `:80` `disabled={!text.trim() || sending}`.
  - **Spec reversal:** `image-paste` scenario "Send image without text" currently REQUIRES blocking ("text is required"); this change flips it (MODIFIED).
  - **Extra finding (not in issue):** the bridge builds `[{type:"text",text:""}, image…]` for an image-only prompt (`packages/extension/src/command-handler.ts:1297-1304` `buildUserMessageContent`, also used by `followup-drain.ts:69`). Providers commonly reject empty text blocks; unblocking the client alone could turn into a failed turn. Explore is unaffected on the wire (callers prefix `/skill:openspec-explore\n`, `SessionOpenSpecActions.tsx:423-428`).
  - **Extra finding:** `DirectoryHomeView.tsx:188-192` `onSend(text)` ignores images and returns on empty text; it must keep blocking image-only (spawn carries no images).

## What Changes

- **#1136** `CommandInput`: send enabled and `handleSend` proceeds when `trimmed` is empty but `pendingImages.length > 0` (button + Enter + Alt+Enter); `onSend("", images, delivery)`. New optional prop `allowImageOnlySend` (default `true`); `DirectoryHomeView` passes `false`. `ExploreDialog`: same guard using its own `pendingImages`. Empty text and no images stays blocked.
- **#1136** Bridge: `buildUserMessageContent` omits the text block when `text` is empty and images survive validation (all-images content array); empty text and no valid image keeps today's string result.
- **#1116** When a prompt is opted in (`allowOther: true`) and lists its own "Other…" option, the inline row replaces it: `isOtherAllowed` drops the `!hasOwnOtherOption` clause; renderers filter own-Other options out of the option list (new shared `isOwnOtherOption`); typed text is the answer. The literal option string stays a valid REST answer. Prompts without `allowOther` are untouched. *(confirmed (owner, 2026-11-20) — see design.md D1, `/tmp/issue-batch/fix-input-state-consistency-DECISIONS.md`)*
- **#1117** New client store `lib/state/prompt-draft-storage.ts` keyed `ask-draft:<sessionId>:<promptId>` (localStorage JSON, debounced, size-capped, TTL-swept); `usePromptDraft` hook; Select/Multiselect/Input/Batch renderers initialise from and write to it; renderers get an optional `sessionId` prop. Pasted images stay in an in-memory map. Cleared on answer/cancel/non-pending status/session removal.
- **#1117** Additive `promptId` on `QuestionRow` so `QuestionDialog` shares the key with the chat card and panel.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `interactive-renderers` — MODIFIED "Inline Other enablement and suppression"; ADDED "Caller's own Other option collapses into the inline row".
- `chat-input-state` — ADDED "Per-prompt answer draft persistence", "Prompt draft storage and lifecycle".
- `image-paste` — MODIFIED "Images sent with message" (image-only); ADDED "Image-only prompt carries no empty text block".
- `chat-view` — MODIFIED "One morphing send/stop action button" (send enabled with images only).

## Non-goals

- Changing pi-flows or other external emitters; default-on `allowOther` for all selects (rejected in archived D1).
- Persisting `editor` renderer text, or pasted-image bytes across reload.
- Server-side persistence of partial answers (drafts are browser-local, like the composer draft).
- Image-bearing spawn from the directory home composer.

## Relationship

- Archived `2026-10-19-add-ask-user-inline-other` (#872): introduced the opt-in + own-Other suppression; this change deliberately revises the suppression half only.
- Archived `2026-04-22-chat-input-draft-and-history` (draft mechanism reused), `2026-10-15-add-pending-question-stack` (question ids/dialog), `2026-08-24-fix-bridge-followup-image-drop` (image delivery).
- No overlapping active change found (grepped `openspec/changes/*/proposal.md` for `allowOther`, `chat-draft`, `CommandInput`, `ExploreDialog`). No fold needed.

## Discipline Skills

- `review-code` — non-trivial multi-package change; run before commit.
- `doubt-driven-review` — #1116 changes the answer contract (shared predicate used by REST validator) and the additive `QuestionRow.promptId` protocol field.
- No auth/secrets/untrusted-input/latency-budget trigger. (Draft JSON read from localStorage is parsed defensively; covered by tests, not a security surface.)

## Impact

- Client: `components/chat/CommandInput.tsx`, `components/folder/DirectoryHomeView.tsx`, `components/openspec/ExploreDialog.tsx`, `components/interactive-renderers/{Select,Multiselect,Input,Batch}Renderer.tsx`, `types.ts`, `components/chat/{ChatView,MultiAskPanel}.tsx`, `components/questions/QuestionDialog.tsx`, new `lib/state/prompt-draft-storage.ts` + hook, `App.tsx` (session-removal sweep).
- Shared: `prompt-answer.ts` (predicate, `isOwnOtherOption`), `question-types.ts` (`promptId`).
- Server: `questions/question-store.ts` row projection adds `promptId`. Compat: additive optional field; old clients ignore it. Rollback: revert; no persisted data (localStorage drafts are orphaned keys, TTL-swept).
- Extension: `command-handler.ts` `buildUserMessageContent`.
- Behaviour change to flag: REST `validateQuestionAnswer` now accepts custom text for opted-in prompts that list their own Other (previously rejected `400`).
