## Context
Three small client fixes plus one contract tweak. Only D1 and D3 are real decisions.

## Decisions

### D1 — #1116: own-Other option under an opted-in prompt (confirmed — owner, 2026-11-20)
Options:
- A. No change; document the split as intended.
- B. **Chosen (recommended):** keep opt-in. For an opted-in prompt, the inline row replaces the caller's own "Other…" option; typed text is the answer.
- C. Default-on for all selects. Rejected: pi-flows branch routing needs an exact option (archived D1).

Why B: `allowOther: true` already declares "free text is acceptable", so B only removes the duplicate row + second `input` prompt (the observed inconsistency) for the dominant emitter, `ask_user`. Non-opted-in prompts stay byte-identical. One predicate stays shared by UI and REST (`isOtherAllowed`), so the row shows iff the REST road accepts custom text. The literal "Other (describe)" string is still a valid option for REST clients. Heuristic stays English-only (`hasOwnOtherOption` regex reused as per-option `isOwnOtherOption`).
Residual: the model may still ask a follow-up `input` after getting custom text; the existing custom-answer note line already tells it the user typed free text.

### D2 — #1117: store shape
- localStorage `ask-draft:<sessionId>:<promptId>` → `{v:1, savedAt, state}`; `state` is renderer-specific JSON (select/multiselect: `{otherActive, otherText, checked[]}`; input: `{value}`; batch: `{answers, step, otherDraft}`).
- Writes debounced (reuse the chat-draft debounce constant); per-entry cap 16 KiB (over cap → skip write, keep memory copy); parse failures → ignore entry.
- Images (input renderer, batch input answers): module-level in-memory `Map` only (survives session switch, not reload) — matches `chat-input-state` "Per-session pending image attachments".
- Cleared: on `onRespond`/`onCancel`, when renderer `status !== "pending"`, on session removal (same place as `deleteDraft` sweep, `App.tsx:1740`), and TTL sweep (7 days) at hydrate.

### D3 — #1117: cross-surface key
Key by (`sessionId`, `promptId`). Chat card/panel already hold `request.requestId` = promptId and the session id; the dialog only has the store id. Chosen: add optional `promptId` to `QuestionRow` (store already has `rec.promptId`, `question-store.ts:74`). Rejected: key by store id only (surfaces would not share); lookup endpoint (extra round-trip for one string).
Verify in task 3.x that chat `requestId` equals store `promptId` (store keys by prompt id from the gateway's pending-prompt hook).

### D4 — #1136: directory-home composer
`CommandInput` gains `allowImageOnlySend` (default true); `DirectoryHomeView` passes false since spawn takes text only. Simpler than teaching spawn about images (non-goal).

## Risks
- Restoring a batch draft whose `questions` changed (same promptId, different shape) → validate lengths/step bounds on load, else discard.
- Restored Other row on a prompt that is no longer opted in → renderer ignores `otherActive` unless `isOtherAllowed`.
