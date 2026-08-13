# DOX — docker/scripts

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `knip-harness-check.sh` | Runs the dead-code oracle inside the harness container: `knip-config.mjs` first (an unrooted graph reports live files as dead, so a count comparison over it compares two kinds of noise), then `knip-ratchet.mjs`. Reproducibility check, not a second gate — Knip is deterministic, so a differing verdict means the container tree differs from the host, which is exactly what it guards. See change: add-knip-dead-code-oracle. |
| `seed-auth.js` | First-run auth seeder. Reads `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` → writes `~/.pi/agent/auth.json` (provider ids anthropic/openai/google, `{type:"api_key",key}`) mode 0600. Skips if file exists. See change: docker-packaging. |
