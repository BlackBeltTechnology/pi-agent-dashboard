# question-store.ts — index

Owns one `QuestionRecord` per pending PromptBus prompt. `createQuestionStore(deps)` → `QuestionStore`. Deps: `eventStore`, `files`, `describeSession`, `briefs`, `config()` (live `questions` config), `now?`, `mintId?`.

- Tracking: `onTracked(sessionId,msg)` called from gateway `trackPromptRequest` AFTER the event-wiring notify guard (notify creates nothing). Id = 128-bit base64url (22 chars); re-send of same key → same record, nothing recomputed; re-track after removal → new id.
- Removal funnel (immediate `removed`, file deleted, idempotent): `removeQuestion(sid,pid,reason)`, `reconcileSession(sid,keepIds)`, `removeQuestionsForSession(sid,reason)` — wired in `browser-gateway.ts` `clearPromptRequest` / `reconcilePromptRequests` / `clearPendingRequestsForSession` (session death, cancel, timeout go through them). Also deletes persisted-but-unbound files.
- Reads: `get`, `getDetail(id)` (QuestionDetail; `answerable=false` for file-access origin or claimed), `listRows(isVisible?)` (open rows, newest first, light), `lookup(id)` → `open|answered|unknown`.
- Claim latch (synchronous, shared REST + browser `prompt_response` — REST step 5.2): `claim(id)` / `claimPrompt(sid,pid)` → `claimed|answered|unknown`; `releaseClaim(id)` (never reopens transmitted); `markTransmitted(id)` hides the row (`hidden` change) while the record stays until `prompt_dismiss` echo; 10-min in-memory window (`TRANSMITTED_WINDOW_MS`) → `answered` (409) then `unknown` (404); not persisted. Latch holds while the record lives.
- Briefs: policy at track (provided / disabled→`unavailable` / generate→`pending`); one automatic attempt, failure → `failed` tombstone; `summarize(id)` on-demand (any non-generated brief; failure keeps current brief; `already-generated`/`not-found` refusals; joins an in-flight generation).
- Restart: `loadPersisted()` (sync, boot) + `sweepAtBoot(presence)`; re-send rebinds id/snapshot/brief; file still `pending` ⇒ interrupted attempt ⇒ `failed` (zero model calls).
- `onChange(listener)` kinds `added|brief|hidden|removed`; `getStats()` → `/api/health#questions`.

Tests: `__tests__/question-store.test.ts`, `question-gateway.test.ts`, `question-wiring.integration.test.ts`. See change: add-pending-question-stack.
