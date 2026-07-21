# session-discovery.ts — index

Standalone per-cwd session discovery from `~/.pi/agent/sessions/<encoded-cwd>/`. Exports `DiscoveredSession`, `discoverSessionsForCwd(cwd)` — reads JSONL headers, condenses first user message, sorts newest-first. No pi-coding-agent dependency.
