# draft-storage.ts — index

Per-session chat-input draft persistence in `localStorage` under `chat-draft:<sessionId>`. Exports `DRAFT_KEY_PREFIX`, `readAllDrafts` (Map), `writeDraft`, `deleteDraft`. All helpers try/catch — silent no-op in private mode / quota-exceeded.
