# pi-default-remirror.ts — index

`createPiDefaultRemirror({readDashboardConfig, readRoles?, fsDeps?, log?})` → `{seed, noteMirrorWrite, remirror, defaultModelRef}`. In-memory last role-default resolution (`provider/id:level`). `seed()` at server start (no write). `noteMirrorWrite()` after every mirror write (config save, sync-defaults) via module `notePiMirrorWrite()` + `setActivePiDefaultRemirror`. `remirror()` writes pi only when the resolution changed; one log line per write/failure. Concrete default → never writes. See change: default-model-follows-role.
