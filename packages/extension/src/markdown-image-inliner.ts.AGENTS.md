# markdown-image-inliner.ts — index

Bridge helper rewriting assistant `![alt](path)` → `![alt](pi-asset:<hash>)` (SHA-256/16, MIME allowlist, 5 MB/img + 20 MB/msg caps). Adds `inlineLocalImagePath(absPath, opts)` single-path inliner returning `AssetToEmit` \| `ReadFileError` (kinds extended with `NOT_IMAGE` / `TOO_LARGE`). See change: inline-agent-screenshot-artifacts.
