# file-mention-resolve.spec.ts — index

L3 (change: server-side-file-mention-resolution, S19). Sends `[[faux:text-tildelink]]`; clicks the `~/.pi/agent/settings.json` FileLink; asserts the preview overlay opens with `file-preview-code` (seeded home file read) and NO `file-preview-error` — proves the tilde mention resolves server-side to the HOME path, not a `/`-rooted 404. Stubs `/api/open-editor`→500 (mirrors tool-output-links). Needs `PI_E2E_SEED=1`.
