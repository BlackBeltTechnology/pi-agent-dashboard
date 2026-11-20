## 1. Server: outside-containment resolve result (tests first)

- [ ] 1.1 Test `resolve-file-mention` (`packages/server/src/lib/__tests__/`): `~/Downloads/x.md` outside cwd, no grant → `{resolved, kind:"tilde", outside:true}`, `fs.stat` not called, identical for existing/missing file
- [ ] 1.2 Test: `~/../../etc/passwd` → normalized, `outside:true`, no stat; granted outside path → contained result without `outside`; contained-missing → `null`
- [ ] 1.3 Test route `POST /api/file/resolve-mention` maps `outside` through and still 403s a non-admitted cwd before any resolution
- [ ] 1.4 Implement: `resolveFileMention` returns `outside:true` on containment failure (no stat); route passes the field through
- [ ] 1.5 Run `security-hardening` pass over the endpoint; note payload change in `docs/security/http-route-inventory.md` via DocScribe

## 2. Client: FileLink routes to the editor pane

- [ ] 2.1 Test `FileLink.split.test.tsx`: absolute path under cwd → `openInSplit("rel")`, no overlay; `~/` outside → `openInSplit(abs)`; no live split + sessionId → navigate to `buildEditorUrl`; no sessionId → overlay; `{resolved:null}` → not-found; resolve failure → unchanged fallback
- [ ] 2.2 Add `outside?: boolean` to `ResolveMentionResult` (`lib/api/resolve-mention-api.ts`)
- [ ] 2.3 Implement in `FileLink.tsx`: drop `!absolute` from `canSplitOpen`, open `normalizeUnderCwd(result.resolved, cwd)`, add `buildEditorUrl` navigation branch; update the file's header comment

## 3. Server + client: out-of-cwd tabs editable via the write grant gate

- [ ] 3.1 Test `writable-md-target.test.ts` (`packages/server/src/lib/__tests__/`): the extracted extension/dashboard-state helper accepts `.md/.mdx/.adoc/.asciidoc/.csv`, rejects `.mmd/.mermaid` (directory-only), `x.png`, and the dashboard state dir; `isWritableMdTarget` results unchanged
- [ ] 3.2 Tests in `__tests__/file-write-endpoint.test.ts`: inside-cwd write unchanged (no prompt); outside-cwd text doc, no grant, prompt-eligible → request suspends, allow → 200 + `mtime`; deny / expiry → `403` with remedy fields and file untouched; granted subtree → 200 with no prompt; bare loopback without proof → immediate `403`; git-common-root path outside cwd without grant → not admitted; `x.png`/dashboard state under a granted dir → `403`, no prompt; symlink repointed during the hold → refused, nothing written; stale `mtime` outside cwd → `409`; no `cwd` (global scope) outside `~/.pi/agent` → `403`, no prompt
- [ ] 3.3 Tests `MarkdownViewer` / `EditablePreviewTab` with an absolute out-of-cwd path: Edit toggle present; save answered `403` → error shown, buffer stays dirty, nothing cleared; save `200` clears dirty
- [ ] 3.4 Implement server: export the extension/state half of `isWritableMdTarget`; in `prepareMdWrite` (pass `request`/`reply`) call `evaluateContainment(realpath, [admitted.cwd], {site:"file-routes:write", subjectKind:"file", session, hold, disclosure})` only for the outside-cwd text-doc case; map a refusal to `403` + remedy via `sendGateFailure`; make `performAtomicMdWrite` refuse when its realpath differs from the gated one
- [ ] 3.5 Client: no gating on `editable` (keep `fileKind(...).editable` only); confirm the existing `setError(body.error)` path renders the `403` message ("write not granted") and add the string via `t` if the server text is not shown
- [ ] 3.6 Run `security-hardening` + `doubt-driven-review` over the write-gate widening (read grant now admits allowlisted writes; confirm the prompt copy and `site` label in `access-denials`/dialog are acceptable) and note the route change in `docs/security/http-route-inventory.md` via DocScribe

## 4. Client: unsaved-edits guard

- [ ] 4.1 Tests for the registry/`confirmLeave` (clean → resolves true, no dialog; dirty → dialog; Save ok / 409 / 403 / Discard / Cancel outcomes)
- [ ] 4.2 Tests for call sites: single tab close, bulk close (`planBulkClose` lists built-in dirty once; Close all & discard), pane close button, layout "chat" segment, `handleSelect`, clean + dirty cases each
- [ ] 4.3 Test `beforeunload` armed only while dirty and removed on save/discard
- [ ] 4.4 Implement registry + `confirmLeave` + dialog component in `SplitWorkspaceContext` / new `UnsavedChangesDialog.tsx` (i18n strings via existing `t`)
- [ ] 4.5 Publish `{dirty, save}` from `MarkdownViewer` and `EditablePreviewTab`; wire the call sites and `beforeunload`
- [ ] 4.6 Extend `close-risk.ts` lookups + `BulkCloseConfirm` reason text for built-in unsaved tabs

## 5. Verify and land

- [ ] 5.1 Update `AGENTS.md` per-file rows touched (`tool-renderers`, `lib/api`, `editor-pane`) — `docs/` prose via DocScribe
- [ ] 5.2 `npm test` (tee to `/tmp/pi-test.log`, grep summary); `npm run quality:changed`
- [ ] 5.3 Server change → `npx tsx .pi/skills/implement/scripts/restart-server.ts`; client change → `npm run build` + restart; manually click an absolute-path and a `~/` link, edit + save an out-of-cwd file (grant prompt appears; deny keeps the buffer) and a dirty close
- [ ] 5.4 `review-code` pass before commit
- [ ] 5.5 `npx openspec validate fix-file-link-editor-routing --strict`
