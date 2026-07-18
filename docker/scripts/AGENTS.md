# DOX — docker/scripts

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `seed-auth.js` | First-run auth seeder. Reads `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` → writes `~/.pi/agent/auth.json` (provider ids anthropic/openai/google, `{type:"api_key",key}`) mode 0600. Skips if file exists. See change: docker-packaging. |
