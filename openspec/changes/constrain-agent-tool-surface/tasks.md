## 1. Preconditions

- [ ] 1.1 Confirm no flow step invokes a built-in tool (`read`/`bash`/`edit`/`write`/`grep`/`find`) at the model layer, so `--no-builtin-tools` is safe for guarded sessions.
- [ ] 1.2 Confirm the exact working directory passed for per-invoice flow sessions vs. the persistent "Ask" session (same root or per-invoice subdirs) — sets registry granularity.
- [ ] 1.3 Confirm `pi --no-builtin-tools` and repeatable `-e` behave as documented against the pinned pi version.

## 2. Guarded-directory registry

- [ ] 2.1 Add a host-side guarded-working-directory registry (register / query by working directory), owned by the server and populated by first-party plugins.
- [ ] 2.2 Register the invoice plugin's workspace working directory(ies) as guarded on plugin init; deregister on dispose.

## 3. `spawnPiSession` enforcement

- [ ] 3.1 Extend `spawnPiSession` options with a flag to disable built-in tools.
- [ ] 3.2 In `spawnPiSession`, consult the guarded-directory registry for the spawn's working directory and, when guarded, inject `--no-builtin-tools` into the pi CLI args.
- [ ] 3.3 Ensure the injection applies regardless of spawn strategy and is a no-op for unregistered directories.

## 4. cwd-containment tool_call guard

- [ ] 4.1 Author a `tool_call` guard extension that rejects any tool call whose path argument resolves (after `fs.realpath`) outside the guarded working directory; normalize separators + drive-letter case (Windows), reusing `file-read-containment` logic.
- [ ] 4.2 Load the guard via `-e` at spawn for guarded directories (alongside `--no-builtin-tools`); no-op for unregistered directories.

## 5. Cover both spawn paths

- [ ] 5.1 Plugin spawn hook (`server.ts` `spawnSession`) / `PluginSpawnOptions` carry the restriction for plugin-spawned sessions.
- [ ] 5.2 Generic client spawn path (`session-api` / `event-wiring`) applies the same policy via the working-directory check — no UI-side change.
- [ ] 5.3 Verify both a per-invoice flow session and a freshly spawned "Ask" session launch with built-in tools disabled and the guard loaded.

## 6. Tests (faux/offline gate)

- [ ] 6.1 Unit: guarded directory → `spawnPiSession` args include `--no-builtin-tools` + the guard `-e`; unregistered directory → args unchanged.
- [ ] 6.2 Unit: both spawn paths produce the restriction for a guarded working directory (policy is path-keyed, not spawn-path-keyed).
- [ ] 6.3 Unit: the guard blocks a tool call with a path resolving outside cwd (incl. a symlink escape) and allows one inside cwd.
- [ ] 6.4 Run the dashboard faux/offline gate (`npm test` + `npm run build`) green.

## 7. Docs

- [ ] 7.1 Update the relevant `AGENTS.md` (server + plugin) to note the guarded-directory policy + the cwd-containment guard.
- [ ] 7.2 Note OS-level isolation (Gondolin / container) as optional, additive work for non-tool threats only (not required for cwd containment); record the Gondolin no-Windows finding.
