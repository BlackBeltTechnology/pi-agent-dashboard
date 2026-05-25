## 1. Shared utility

- [ ] 1.1 Add a `.text-code` utility class to `packages/client/src/index.css` inside an `@layer utilities` block. Body: `font-size: 12px; line-height: 1.5;`. No `font-family` — let callers keep their existing `font-mono` where needed.
- [ ] 1.2 Verify the class is purged-safe under the existing Tailwind config (utility class defined in `@layer utilities` is not auto-purged when used via `className="text-code"`).

## 2. Read / Write renderers

- [ ] 2.1 In `packages/client/src/components/tool-renderers/ReadToolRenderer.tsx`, change the SyntaxHighlighter `customStyle.fontSize` from `"0.7rem"` to `"12px"`.
- [ ] 2.2 In `packages/client/src/components/tool-renderers/WriteToolRenderer.tsx`, same change: `customStyle.fontSize` from `"0.7rem"` to `"12px"`.
- [ ] 2.3 Optional cleanup (do NOT inflate the diff): the surrounding `<div className="... text-xs">` wrappers on the Read/Write code blocks can stay — `text-xs` is the same 12 px and matches all sibling chrome (filename label, status text).

## 3. Edit renderer (the visible bug)

- [ ] 3.1 In `packages/client/src/components/tool-renderers/EditToolRenderer.tsx`, add `className="text-code"` to the `RichDiff` wrapper `<div className="rounded bg-[var(--bg-code)] overflow-hidden">` (both call sites: the `oldText/newText` path and the `edits[]` path). The class must be on a parent that wraps `RichDiff`, so the inherited font-size propagates into the library's internal DOM. If the library renders an isolated stacking context that breaks inheritance, fall back to an inline `style={{ fontSize: "12px" }}` on the same wrapper.
- [ ] 3.2 In the mobile fallback `DiffView` component (top of the same file), replace `text-xs` with `text-code` on the root `<div className="font-mono ... overflow-auto max-h-80">`. Keep `font-mono leading-relaxed` — only the size class changes.
- [ ] 3.3 Manual verification: open a session with both a Read and an Edit tool call to the same file. The code payload in both cards SHALL render at the same px size (devtools computed `font-size: 12px`). Take before/after screenshots for the PR description.

## 4. Bash / Generic renderers

- [ ] 4.1 In `packages/client/src/components/tool-renderers/BashToolRenderer.tsx`, on the output `<pre className="whitespace-pre-wrap text-xs font-mono">`, replace `text-xs` with `text-code`. Leave `whitespace-pre-wrap font-mono` untouched.
- [ ] 4.2 In `packages/client/src/components/tool-renderers/GenericToolRenderer.tsx`, on both `<pre>` elements (the args JSON dump and the result output), replace `text-xs` with `text-code`.

## 5. Non-changes (assert explicitly during review)

- [ ] 5.1 `packages/client/src/components/DiffPanel.tsx` — `fontSize: "13px"` is **unchanged**. DiffPanel is a full-screen viewer, not a tool card.
- [ ] 5.2 `packages/client/src/components/MarkdownContent.tsx` — assistant prose code blocks (``` fences and inline `code`) are **unchanged**. They remain at the inherited 14 px / `text-sm`.
- [ ] 5.3 Filename labels, "Running…" status text, "Open in editor" buttons, `AskUserToolRenderer` chrome — **unchanged**. They are not code payload.
- [ ] 5.4 `EditToolRenderer.tsx` line 65 fallback `<pre className="text-xs text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>` (the no-diffs fallback) — IS code payload, so it SHALL also use `text-code`.

## 6. Spec update

- [ ] 6.1 Add a `MODIFIED Requirements` block to `openspec/changes/unify-tool-renderer-code-font-size/specs/tool-renderers/spec.md` (created during implementation) capturing the new uniform-size requirement for the payload region of Read / Write / Edit / Bash / Generic renderers. Scenarios: "Read and Edit cards for the same file render at the same font-size"; "Mobile and desktop Edit cards render at the same font-size".

## 7. Verification

- [ ] 7.1 `npm test` passes (no existing test should regress; no new behavior tests required).
- [ ] 7.2 `npm run build` succeeds; no Tailwind purge warnings about `text-code`.
- [ ] 7.3 Visual check in dev mode: every tool-card type renders code payload at devtools-measured 12 px.
