## 0. Prerequisite

- [ ] 0.1 Confirm `add-mermaid-auto-repair` is merged to develop and `MermaidBlock` exposes the `{kind: "repaired", code}` outcome; if not, stop and hand back (`SHIP_IT_BLOCKED.md`)

## 1. Server allowlist (TDD, directory scope only)

- [ ] 1.1 Test: in-scope Mermaid sources writable — exemplar `packages/server/src/lib/__tests__/writable-md-target.test.ts`; input `<cwd>/flow.mmd`, `<cwd>/flow.mermaid`, `<cwd>/FLOW.MMD` · trigger `isWritableMdTarget(p, {cwd})` · observable `true` for each (test-plan #E17)
- [ ] 1.2 Test: global scope rejects Mermaid — exemplar `packages/server/src/lib/__tests__/writable-md-target.test.ts` + `packages/server/src/__tests__/file-write-endpoint.test.ts`; input existing `<home>/.pi/agent/flow.mmd` · trigger `isWritableMdTarget(p, {home})` and global-scope `POST /api/file/write` · observable `false` and 403 (test-plan #E18)
- [ ] 1.3 Test: symlinked Mermaid escape rejected — exemplar `packages/server/src/lib/__tests__/writable-md-target.test.ts`; input `<cwd>/flow.mmd` symlink to `<outside>/x.mmd` · trigger `isWritableMdTarget(p, {cwd})` · observable `false` (test-plan #E19)
- [ ] 1.4 Test: picker stays a subset of the guard — exemplar `packages/server/src/lib/__tests__/md-candidates.test.ts`; input cwd with `a.md`, `b.mmd`, `c.mermaid` · trigger `listMdCandidates({cwd})` · observable only `a.md` listed (test-plan #E20)
- [ ] 1.5 Test: md-read + write accept `.mmd` — exemplar `packages/server/src/__tests__/file-write-endpoint.test.ts`; input live session cwd with `flow.mmd` · trigger `GET /api/file/md-read` then `POST /api/file/write` with returned mtime · observable md-read 200 `{content, mtime}`, write 200, disk = posted content (test-plan #E21)
- [ ] 1.6 Verify 1.1–1.5 fail, then accept `.mmd`/`.mermaid` in `packages/server/src/lib/writable-md-target.ts` only when `cwd` is present (global branch unchanged, `md-candidates.ts` unchanged); verify 1.1–1.5 and the existing suite pass

## 2. Block locator + splice (TDD, pure)

- [ ] 2.1 Test: md fence replaced in place — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input md with mermaid #0, a `js` fence, mermaid #1, mermaid #2 · trigger `spliceMermaidBlock(file, "md", 1, fixed)` · observable only lines between fence #1 opener/closer differ, opener+closer and all outside bytes identical (test-plan #E1)
- [ ] 2.2 Test: list-indented fence — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `1. item` + 3-space-indented mermaid fence · trigger splice ordinal 0 with a fixed source containing a blank line · observable non-blank inner lines start with exactly 3 spaces, blank line empty, opener/closer unchanged (test-plan #E2)
- [ ] 2.3 Test: fence variants — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `~~~mermaid` fence and a 4-backtick mermaid fence containing a 3-backtick line · trigger locate ordinals 0 and 1 · observable #1 value includes the inner line, closer is the 4-backtick line, tilde closer preserved on splice (test-plan #E3)
- [ ] 2.4 Test: CRLF preserved — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input md with `\r\n` endings · trigger splice ordinal 0 with LF-joined fixed source · observable inner lines end `\r\n`, no bare `\n` in output (test-plan #E4)
- [ ] 2.5 Test: round-trip invariant — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input md/adoc/mmd fixtures incl. CRLF, BOM, no final newline · trigger `splice(file, n, locate(file, n).value)` · observable result equals input for every fixture and ordinal (test-plan #E5)
- [ ] 2.6 Test: duplicate diagrams — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input two byte-identical failing mermaid fences · trigger splice ordinal 1 · observable first block unchanged, second replaced (test-plan #E6)
- [ ] 2.7 Test: blockquote fence not applicable — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `> ```mermaid` block · trigger locate ordinal 0 · observable `not-applicable` result (test-plan #E7)
- [ ] 2.8 Test: list-marker-line fence not applicable — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `- ```mermaid` block · trigger locate ordinal 0 · observable `not-applicable` (test-plan #E8)
- [ ] 2.9 Test: unclosed fence not applicable — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input md ending inside an open mermaid fence · trigger locate ordinal 0 · observable `not-applicable` (test-plan #E9)
- [ ] 2.10 Test: frontmatter parity — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input YAML frontmatter with a string containing a mermaid fence, then one body mermaid fence · trigger locate ordinal 0 · observable located block is the body fence, count 1 (test-plan #E10)
- [ ] 2.11 Test: AsciiDoc source blocks — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `[source,mermaid]` + `----` block and `[source,mermaid,opts=x]` + 6-dot block · trigger splice ordinals 0 and 1 · observable only lines between each identical delimiter pair change (test-plan #E13)
- [ ] 2.12 Test: AsciiDoc count parity — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input raw adoc with 2 mermaid blocks, `expectedCount` 3 · trigger locate ordinal 0 · observable `not-applicable` (test-plan #E14)
- [ ] 2.13 Test: AsciiDoc substitution mismatch — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input adoc mermaid block with callout `<1>`, splitter source without it · trigger verify · observable verify fails, no write (test-plan #E15)
- [ ] 2.14 Test: mmd whole file — exemplar `packages/client/src/lib/__tests__/adoc-diagram-splitter.test.ts`; input `.mmd` with final newline, without, with BOM, with CRLF · trigger splice ordinal 0 · observable final-newline presence, BOM and line-ending style match input (test-plan #E16)
- [ ] 2.15 Verify 2.1–2.14 fail, then implement `packages/client/src/lib/preview/mermaid-block-locator.ts` (`locateMermaidBlock`, `verifyMermaidBlock`, `spliceMermaidBlock`), export the shared `MARKDOWN_REMARK_PLUGINS` constant, declare `unified` + `remark-parse` in `packages/client/package.json`; verify 2.1–2.14 pass

## 3. Ordinal stamping + source context

- [ ] 3.1 Test: ordinal stamp parity — exemplar `packages/client/src/components/__tests__/MarkdownContent.test.tsx`; input md with 3 mermaid fences + a raw-HTML `<pre><code class="language-mermaid">` block · trigger render `MarkdownContent` · observable fence blocks get ordinals `"0"`,`"1"`,`"2"` equal to locator order, raw-HTML block gets none (test-plan #E11)
- [ ] 3.2 Test: md exact verify with entities — exemplar `packages/client/src/components/__tests__/MarkdownContent.test.tsx`; input fences with `&gt;`, `&amp;`, `<br>` · trigger render + locate same file · observable rendered `code` prop equals located `code.value` (test-plan #E12)
- [ ] 3.3 Test: stable context identity per surface — exemplar `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx` and `packages/client/src/components/editor-pane/__tests__/MarkdownViewer.test.tsx`; input `FilePreviewOverlay`, `MarkdownViewer`, `MarkdownPreview`, `AsciiDocPreview` host, `MermaidViewer` · trigger parent re-render with unchanged props · observable context value `Object.is`-equal, `MarkdownContent` memo not re-run (test-plan #F8)
- [ ] 3.4 Test: non-session cwd offers no action — exemplar `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx`; input surface cwd absent from the live session list · trigger render a repaired diagram · observable no Apply button (test-plan #F9)
- [ ] 3.5 Verify 3.1–3.4 fail, then implement `remarkMermaidOrdinal` (string `data-mermaid-ordinal` via `hProperties`), read it explicitly in `MarkdownCode`, add `MermaidSourceContext` (`{cwd, path, kind, reload, isDirty?, expectedCount?}`) and provide it from the five surfaces only for live-session cwds; verify 3.1–3.4 pass

## 4. Apply action + diff dialog

- [ ] 4.1 Test: chat diagram has no action — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input repaired outcome, no context · trigger render · observable no Apply button, copy-fixed present (test-plan #F1)
- [ ] 4.2 Test: non-repaired diagram has no action — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input context present, outcome `ok` · trigger render · observable no Apply button (test-plan #F2)
- [ ] 4.3 Test: dirty editor disables action — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input context `isDirty: true`, repaired · trigger render · observable Apply disabled, hint "save or discard edits first" (test-plan #F3)
- [ ] 4.4 Test: diff shown after re-read — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input mocked md-read returning matching file · trigger click Apply · observable md-read called once, dialog lists removed on-disk and added fixed lines, POST count 0 (test-plan #F4)
- [ ] 4.5 Test: cancel writes nothing — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input open diff dialog · trigger Cancel, and separately Escape · observable dialog closed, POST count 0, focus back on Apply (test-plan #F5)
- [ ] 4.6 Test: confirm writes with md-read mtime — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input dialog open, md-read mtime `1700000000123.456` · trigger Confirm · observable one POST `{cwd, path, content: spliced, mtime: 1700000000123.456}`, `reload` called once (test-plan #F6)
- [ ] 4.7 Test: accessible modal — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input open dialog · trigger Tab repeatedly · observable `role="dialog"`, `aria-modal="true"`, focus stays inside (test-plan #F7)
- [ ] 4.8 Test: external edit detected — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input md-read file whose block #1 differs from rendered code · trigger click Apply · observable no dialog, POST count 0, "file changed — reload" with reload action (test-plan #X1)
- [ ] 4.9 Test: 409 conflict — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input POST returns 409 · trigger Confirm · observable POST count stays 1, "file changed — reload" (test-plan #X2)
- [ ] 4.10 Test: 404 on re-read — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input md-read 404 · trigger click Apply · observable POST count 0, "file changed — reload" (test-plan #X3)
- [ ] 4.11 Test: network failure on re-read — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input md-read fetch rejects · trigger click Apply · observable POST count 0, "Could not apply fix: <error>", no reload action (test-plan #X4)
- [ ] 4.12 Test: 403 / 500 on write — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input POST 403, and separately 500 · trigger Confirm · observable POST count stays 1, "Could not apply fix: <error>", no reload action (test-plan #X5)
- [ ] 4.13 Test: not-applicable surfaced — exemplar `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; input md-read file with the target fence in a blockquote · trigger click Apply · observable POST count 0, "cannot be applied to this block" (test-plan #X6)
- [ ] 4.14 Test: i18n completeness — exemplar `packages/client/src/__tests__/i18n.test.ts`; input new apply-fix keys · trigger i18n completeness test · observable every key present in EN and HU (test-plan #F10)
- [ ] 4.15 Verify 4.1–4.14 fail, then implement the Apply action, re-read → locate → verify → diff dialog (existing `diff` dependency, focus trap, Escape cancels) → write → reload in `MermaidBlock.tsx`, plus EN + HU i18n keys; verify 4.1–4.14 pass

## 5. Browser E2E (docker harness)

- [ ] 5.1 E2E: md apply end-to-end — exemplar `tests/e2e/diagram-preview.spec.ts`; input session cwd with `docs/flow.md` holding a rule-repairable broken mermaid fence in a list item · trigger FilePreviewOverlay → Apply → Confirm · observable file read back via API differs only inside the block, preview converges with no auto-fixed badge (test-plan #F11)
- [ ] 5.2 E2E: `.mmd` apply end-to-end — exemplar `tests/e2e/editor-pane.spec.ts`; input session cwd with broken `flow.mmd` · trigger editor-pane Mermaid tab → Apply → Confirm · observable file = fixed source with final newline preserved, tab shows no badge (test-plan #F12)
- [ ] 5.3 E2E: AsciiDoc apply with real asciidoctor — exemplar `tests/e2e/asciidoc-preview.spec.ts`; input `guide.adoc` with a broken `[source,mermaid]` block plus a plantuml block · trigger AsciiDoc preview → Apply → Confirm · observable only lines between the mermaid delimiters change, no badge (test-plan #F13)
- [ ] 5.4 E2E: real mtime race — exemplar `tests/e2e/editor-pane.spec.ts`; input file modified via API after the diff dialog opens · trigger Confirm · observable server 409, "file changed — reload" shown, disk content equals the external edit (test-plan #X7)

## 6. Review, docs, verification

- [ ] 6.1 Run `doubt-driven-review` on locator/verify/splice/conflict logic and `security-hardening` on the allowlist change; fold findings into design.md Risks; verify no open High findings
- [ ] 6.2 Update AGENTS.md rows: `writable-md-target.ts`, `mermaid-block-locator.ts` (new), `MermaidBlock.tsx`, `MarkdownContent.tsx`, `AsciiDocPreview.tsx`, `editor-pane/MermaidViewer.tsx`, `FilePreviewOverlay.tsx`, `MarkdownPreview.tsx`, editor-pane `MarkdownViewer.tsx` (See change: add-preview-apply-fix-to-file); verify rows present
- [ ] 6.3 Full suite + `npm run quality:changed`; verify green
- [ ] 6.4 Manual: diff dialog legibility in all 4 themes (studio, earth, athlete, gradient) at desktop and mobile width (test-plan: manual-only, #F14)
