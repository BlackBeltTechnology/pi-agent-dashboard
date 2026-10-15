# DOX — packages/client/src/lib/questions

Files in this directory. One row per source file. See change: add-pending-question-stack.

| File | Purpose |
|------|---------|
| `dialog-answer.ts` | `encodeDialogAnswer(result)` → answer string via shared `encodePromptAnswer`; strips `images` first (REST road is text-only; server rejects images). |
| `question-store.ts` | `QuestionStackStore` (external store, newest-first, `loaded` flag, notifies only on change), singleton `questionStore`, `setQuestions(rows)` (called by `useMessageHandler` on `questions_update`, full replacement), `useQuestionStack(store?)`. |
| `questions-api.ts` | `fetchQuestionDetail`, `answerQuestion({answer}\|{cancelled:true})`, `summarizeQuestion`. Never throws: `{ok:false,status,error,reason?}`. Uses `getApiBase()`. |
| `route-question.ts` | D10 routing. `decideQuestionRoute(row,session)` → `chat`\|`slot`\|`dialog` (visible = `filterSessions([s],false,false)`); `routeQuestion(row,{session,openSession,openDialog})`; polls (≤3 s) for `[data-pending-ask]`/`multi-ask-panel` (chat) or `[data-widget-bar-slot]` (slot), scrolls + focuses it. |
| `__tests__/` | `route-question.test.ts` (F1), `question-store.test.ts`, `dialog-answer.test.ts`. |
