# file-mention-resolve.spec.ts — index

L3 (changes: server-side-file-mention-resolution S19; rewritten by fix-file-link-editor-routing S53). Sends `[[faux:text-tildelink]]`; clicks the `~/.pi/agent/settings.json` FileLink; asserts the editor pane opens (`split-editor-pane`) with ONE `editor-tab` whose `data-tab-path` ends `/.pi/agent/settings.json`, Monaco renders, no `denial-notice`, `file-preview-overlay` count 0 and zero `/api/open-editor` requests (still stubbed →500, counted). Proves the tilde mention resolves server-side to the HOME path and opens as an absolute-path pane tab. Needs `PI_E2E_SEED=1`.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 server-side-file-mention-resolution (S19), fix-file-link-editor-routing (S53).
