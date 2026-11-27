# tasks.ts — index

`createTaskOps`: `TaskCreate`/`TaskList`/`TaskGet`/`TaskUpdate` (one synchronous transition each; validate everything before the first store write; claim = check-and-set; derived `blocked`/`claimable`; result preview/truncation; cycle DFS; owner rules, `owner_locked`), actor forms `createTask`/`updateTask` (actor `server`), `releaseTasksOf` (in_progress → pending + note, owned pending → unowned), `assignmentText`/`dependenciesOf`. `onActivity`/`notify` injected.
