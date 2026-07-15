# Tasks

## 1. Server resolver library (Phase 1 core)

- [ ] 1.1 Add `packages/server/src/lib/resolve-file-mention.ts` exporting
  `resolveFileMention(mention, { cwd })` → `{ resolved: string; kind: "abs" |
  "tilde" | "relative" } | null`. Expand leading `~/` via `os.homedir()`; try
  absolute, then `path.resolve(cwd, mention)`; run each through `isAllowed`
  (containment gate) BEFORE `fs.stat`. → verify: unit tests below.
- [ ] 1.2 Unit tests for `resolveFileMention`: tilde→home (exists), relative→cwd
  (exists), nonexistent→null, `~/../../etc/passwd`→null (containment reject),
  `~user/x`→not expanded. → verify: tests pass.

## 2. Resolve-mentions endpoint (Phase 1 wiring)

- [ ] 2.1 Add `POST /api/file/resolve-mentions` in `file-routes.ts`: body `{ cwd,
  mentions: string[] }` → `{ results: ({resolved,kind}|null)[] }`, gated on known
  cwd + `networkGuard`, calling `resolveFileMention` per mention. → verify: route
  test returns null for junk, resolution for a real repo file.

## 3. Client: loosen detection + confirm-before-link (Phase 1)

- [ ] 3.1 Loosen the `linkify-tool-output.ts` grammar to also emit candidate
  tokens for bare `basename.ext` (no separator) and leading `~/…`, marked as
  UNCONFIRMED. Preserve the join-coverage contract. → verify: tokenizer test —
  `~/…` is ONE token, `monaco-setup.ts` emits a candidate token.
- [ ] 3.2 Add a client hook that batches a message's candidate mentions to
  `/api/file/resolve-mentions`, caches by `(cwd, mention)`, and exposes
  resolution state. → verify: hook test with a mocked endpoint.
- [ ] 3.3 `FileLink` (or a wrapper) renders a candidate as plain text until its
  resolution is confirmed non-null; on confirm, style as link and open the
  server-resolved path. → verify: component test — null resolution → no anchor;
  confirmed → anchor with resolved target.

## 4. Fuzzy fallback (Phase 2)

- [ ] 4.1 Extend `resolveFileMention` with a `git ls-files`-scoped basename
  search (bounded, cached per cwd). Resolve ONLY on a unique match; >1 → null.
  Skip when cwd is not a git repo. → verify: tests — unique basename resolves,
  colliding basename (`tasks.md`) returns null, non-repo cwd skips fuzzy.

## 5. Link-origin / worktree interaction

- [ ] 5.1 Fold worktree re-rooting into the server resolver (it knows cwd + git
  root); confirm a `~/…` home path bypasses re-rooting. → verify: worktree-session
  test — relative mention resolves to the worktree's own copy; `~/…` stays home.

## 6. Validate

- [ ] 6.1 `npx openspec validate server-side-file-mention-resolution --strict` passes.
- [ ] 6.2 `npm test` green; manual: a message with `~/.pi/agent/settings.json`,
  a bare `monaco-setup.ts`, a `tasks.md`, and a doc-example `foo.ts` links the
  first two, refuses `tasks.md` (ambiguous), and leaves `foo.ts` as plain text.
