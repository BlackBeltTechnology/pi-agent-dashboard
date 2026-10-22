# DOX — packages/claude-plugin

Claude plugin `pi-dashboard` (skills only). Not an npm workspace: no `package.json`. Marketplace manifest lives at repo root `.claude-plugin/marketplace.json` (name `pi-agent-dashboard`, source `./packages/claude-plugin`). Zipped per release by `scripts/build-claude-plugin-zip.mjs`. See change: add-claude-code-plugin.

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest. name `pi-dashboard`. No `displayName` (validator rejects). `version` stamped = root version by `scripts/sync-versions.js`; tests: `claude-plugin-version.test.mjs`. |
| `../../.claude-plugin/marketplace.json` | (repo root, outside this dir) Marketplace manifest. name `pi-agent-dashboard`, one plugin `pi-dashboard` → `./packages/claude-plugin`. Test: `claude-plugin-structure.test.mjs`. |
| `AGENTS.md` | This file. |
| `LICENSE` | MIT copy of root LICENSE. |
| `README.md` | Install paths, copy-paste install prompt (`claude plugin` CLI + `--plugin-dir` zip fallback), surfaces table, localhost-only data note. ≥40 words outside fences (structure test). |
| `skills/pi-dashboard-bootstrap/SKILL.md` | One foreground command, 600 s timeout, never background. Per-`STATUS` instructions. Consent question before `--install`. No workarounds on `sandbox`. |
| `skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh` | POSIX sh bootstrap. One `STATUS=` line + `BASE=`/`INSTALL=` on stdout, rest stderr. Exit 0 ready/1 failed/2 sandbox/3 busy+recovery/4 not-installed/5 port-conflict. `--check` verify-only, `--install` consented global npm install. Launches only on sustained refusal with no live/unknown recorded pid. Never overrides HOME. Test-only `PIDB_TEST_*` timing overrides (need `PIDB_TEST=1`). Tests: `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs`. |
| `skills/pi-dashboard-control/SKILL.md` | curl against `BASE`: health, sessions, prompt, abort, spawn. Token rules: ask user for `token create --label claude-code --tier control`, `-H @file`, `--check &&` chaining, no `-v`. |
| `skills/pi-dashboard-control/references/api-reference.md` | DERIVED. Extension skill's `api-reference.md` minus the bus-verbs section. Regenerate: `node scripts/sync-claude-plugin.mjs`. Parity test fails on drift. |
