# DOX — packages/server/src/changelog

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `changelog-fs.ts` | `findChangelogPath(pkg, opts)` resolves CHANGELOG.md (managed > bare-import > filesystem-walk). → see `changelog-fs.ts.AGENTS.md` |
| `changelog-parser.ts` | `parseChangelog(text)` Keep-a-Changelog regex parser. `readAndParseChangelog(path)` mtime-keyed 60s cache. → see `changelog-parser.ts.AGENTS.md` |
| `changelog-remote.ts` | Fetch upstream CHANGELOG.md from GitHub raw for release notes newer than local tarball. → see `changelog-remote.ts.AGENTS.md` |
