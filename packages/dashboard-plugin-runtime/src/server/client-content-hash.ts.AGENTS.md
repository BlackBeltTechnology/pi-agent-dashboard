# client-content-hash.ts — index

`createContentHasher({digestFile?})` → `{hashDir(dir), clear(), digestCalls}`. `hashDir` = sha256 over sorted `(relpath, sha256(file))` of allowlisted (`PLUGIN_ASSET_MIME`, `.gz` ok), realpath-confined files; dotfiles skipped, symlink escapes never hashed, symlinked dirs not followed; `undefined` when dir absent. Per-file stat cache keyed `(relpath,size,mtimeMs,ino,ctimeMs)`; `clear()` drops all (discovery refresh, package-op completion). Recomputed every read, no wildcard pin. See change: decouple-plugins-from-core (task 6.7, D12).
