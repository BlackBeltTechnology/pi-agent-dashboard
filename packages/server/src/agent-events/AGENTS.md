# DOX — packages/server/src/agent-events

Files in this directory. One row per source file. See change: add-agent-event-stream.

| File | Purpose |
|------|---------|
| `agent-event-hub.ts` | `createAgentEventHub({listQuestionRows, ownerOf})` → `{onRegistryFrame, onQuestionChange, openQuestions, ownerOf, subscribe}`. Inputs: gateway `onRegistryFrame` tap (`session_added/updated/removed`) + `questionStore.onChange`. Output `AgentEvent`: `session_added`, `status {from?,to}` (only on change; `from` absent if never seen), `session_removed`, `question_opened` (from `listRows` row; deduped), `question_closed {reason}` (`hidden` = answered; its later `removed` suppressed; plain `removed` = removed). Listener gets last known owner (frame-cached, survives removal). Throwing listener logged, others still served. `AGENT_EVENT_TYPES`. Wired once in `server.ts`. |
| `__tests__/agent-event-hub.test.ts` | Transitions dedupe, unknown `from`, removal, non-registry ignored, owner after removal, question open/close/answered/removed, `openQuestions`, listener isolation. |
| `__tests__/agent-event-stream.integration.test.ts` | Real in-process server: bridge `session_register` → `session_added`; `prompt_request` → `question_opened`; `prompt_dismiss` → `question_closed removed`; `unregister` → `ended`/`session_removed`; `?session=` filter holds. |
