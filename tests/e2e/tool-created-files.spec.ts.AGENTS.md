# tool-created-files.spec.ts — index

L3 spec (change: detect-tool-created-files, U1+U3). `spawnFreshGitSession` + `dirtyMarkdown(README.md)` (out-of-band → `otherChanges`) + `[[faux:tool-bash-artifact]]` (bash writes `tool-artifact.md` in cwd → `origin:"tool"`). Opens Files panel: asserts `origin-badge` + `created by` on the tool row (U1), and the collapsed `other-changes-group` + `session-only-toggle` hides it (U3).
