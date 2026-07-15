# Test plan (manifest) — fix-session-diff-open-nongit-and-preview

Manifest for the **design-addendum scope** (sibling `openInSplit` sinks + duplicate-tab +
guard-mirrors-server). The original Decision 1–3 scope is already covered by `tasks.md` §1–5
and the `## Tests / Validate` block (T.1–T.3); this manifest adds only what the addendum
introduced. Each row carries `level` + `disposition`; `ship-it`/`ship-change` map tasks back
via the `(test-plan #<id>)` reference.

| id | scenario (input · trigger · observable) | level | disposition | exemplar |
|----|------------------------------------------|-------|-------------|----------|
| A1 | `toSessionRel(cwd, p)` guard mirrors the server: {abs-under-cwd → relative-posix} · call · returns the relative key; {abs-outside-cwd (posix `..`), cross-drive `path.win32`, already-relative} · call · returns `p` unchanged | L1 | automated | `SplitWorkspaceContext.test.tsx` |
| A2 | SplitWorkspace mounted with `cwd`; `openInSplit`/`openDiffTab` called with an **abs-under-cwd** path · dispatch · stored tab identity is the **relative** key (`openFiles[].path` = rel, `diff:<rel>` — no `cwd//abs` double-root) | L1 | automated | `SplitWorkspaceContext.test.tsx` |
| A3 | reducer receives the same file as `diff:/abs` then `diff:<rel>` (post-normalization both = `diff:<rel>`) · `openFile` reducer · `openFiles` has exactly ONE entry (no duplicate tab) | L1 | automated | `editor-pane-state.test.ts` |
| A4 | session with changes, desktop width; click the content-view change-summary row for file X, then the Changes-rail row for X · UI · editor pane shows exactly ONE tab for X | L3 | automated | `change-summary-table.spec.ts` + `editor-pane.spec.ts` |
| A5 | navigate `/session/:id/editor?file=<abs-under-cwd>` · `SplitRouteSync` → `openInSplit` · a file tab opens with a canonical relative identity and renders content (no error, no duplicate) | L3 | automated | `editor-pane.spec.ts` |

All rows `automated` — no `manual-only` deferrals in the addendum scope.
