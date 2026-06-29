# Tasks

## 0. Resolve open questions (pre-implementation)

- [x] 0.1 RESOLVED: `data.target` is ABSOLUTE for both `code` + `code-decision` nodes (live event: `/home/.../.pi/flows/flows/custom/<flow>/<id>.ts`). No cwd resolution needed; allow-list `<cwd>/.pi/...` matches. (O1)
- [x] 0.2 RESOLVED: `MarkdownContent.tsx` routes fenced blocks through `react-syntax-highlighter` (Prism) on `language-<lang>` + copy button — fenced `ts` highlights. (O2)

## 1. Plugin — code-source state + fetch effect

- [x] 1.1 In `FlowAgentCard.tsx`, add `codeSourceOpen` boolean state + `codeSourceState: AgentSourceState` (reuse the existing type)
- [x] 1.2 Add a fetch effect mirroring the `sourceOpen`/`sourcePath` effect but keyed on `[codeSourceOpen, agent.codeTarget]`; fetch `/api/pi-resource-file?path=<resolved codeTarget>`; set loaded/error
- [x] 1.3 N/A — O1 confirmed `codeTarget` always absolute; pass through verbatim (no cwd plumbing, simplicity-first)

## 2. Plugin — code icon button + dialog

- [x] 2.1 Add an `mdiCodeBraces` button to the bottom-right control row, gated `isCodeKind && agent.codeTarget`; `e.stopPropagation()` so it does not toggle card selection; toggles `codeSourceOpen`
- [x] 2.2 Render a `ui:dialog` (`size="lg"`) whose title is the handler basename; body shows loading/error, or on loaded renders `<MarkdownContent content={"```ts\n" + content + "\n```"} />`
- [x] 2.3 Keep the existing `‹› {codeTarget}` text line (D1)

## 3. Tests

- [x] 3.1 Code-kind card with `codeTarget` renders the code-source button; agent-kind card does not; code-kind card without `codeTarget` does not
- [x] 3.2 Clicking the code button opens a dialog and issues a fetch to `/api/pi-resource-file?path=<codeTarget>`
- [x] 3.3 Loaded content is wrapped in a ```ts fence before reaching `MarkdownContent`
- [x] 3.4 Fetch error renders the error message in the dialog
- [x] 3.5 N/A — O1 confirmed absolute; no relative-resolution path to test

## 4. Validate

- [x] 4.1 `npm test` green for `packages/flows-plugin` (16 files, 106 tests pass; new file 4/4); `tsc --noEmit` clean
- [x] 4.2 `openspec validate open-code-handler-from-flow-card --strict` passes
- [ ] 4.3 Manual (USER): run a flow with a code node; open a code card's new `‹›` icon; confirm the `.ts` renders syntax-highlighted
