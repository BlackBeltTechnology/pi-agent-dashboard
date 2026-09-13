# DOX — packages/browser-plugin/src/server/relay

Files in this directory. One row per source file. See change: add-browser-relay (task 2.2, design D2).

| File | Purpose |
|------|---------|
| `vendor/` | Vendored playwright-core relay + shims — see `vendor/AGENTS.md`. NEVER edit anything under `vendor/playwright-core/` (hash test `../__tests__/vendor-integrity.test.ts` enforces); refresh = re-copy from upstream + regenerate the hash manifest. Adaptation (bypass `WSServer` transport, deny-list, audit hooks) happens in `relay-instance.ts` (workstream 2c) via subclass/wrapper, never by editing vendor files. |
