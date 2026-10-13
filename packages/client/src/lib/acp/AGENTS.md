# DOX — packages/client/src/lib/acp

Files in this directory. One row per source file. See change: add-acp-session-driver.

| File | Purpose |
|------|---------|
| `agent-memory.ts` | Per-folder remembered spawn agent in localStorage (`pi-dashboard:spawn-agent:<cwd>`). `getRememberedAgent(cwd, agents)` → id or undefined (pi; also when the agent was removed), `rememberAgent`, `agentMemoryKey`. Tolerates unavailable storage. |
