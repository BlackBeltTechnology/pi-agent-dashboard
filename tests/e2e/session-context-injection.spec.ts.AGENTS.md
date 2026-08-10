# session-context-injection.spec.ts — index

Playwright spec. Spawns session, sends `[[faux:echo-system-context]]`, asserts rendered text contains injected fragment (`── pi-dashboard session context ──` + `You are pi session`). Proves before_agent_start injector reaches model through Docker stack, no LLM. See change: inject-session-context-into-agent.
