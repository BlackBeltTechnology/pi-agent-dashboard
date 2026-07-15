# Tasks

## 1. Theme token

- [x] 1.1 Add `"--table-stripe"` to `CSS_VAR_KEYS` in `packages/client/src/lib/themes.ts`.
- [x] 1.2 Add two shared consts `darkTableVars` / `lightTableVars` and merge them
  into every theme's `dark` / `light` map (alongside the existing `withStatus`
  merge) → verify: `THEMES.every(t => t.dark["--table-stripe"] && t.light["--table-stripe"])`.
- [x] 1.3 Add `--table-stripe` to `:root` and `[data-theme="light"]` in
  `packages/client/src/index.css` so the `base` theme resolves it.

## 2. Table CSS

- [x] 2.1 Replace the `.markdown-content table` block
  (`packages/client/src/index.css:190-193`) with the proposed block from
  `design.md` (separate borders + radius + overflow clip; `thead th` on
  `--bg-surface`; `tbody tr:nth-child(even)` on `--table-stripe`; kept column
  separators; row hover on `--bg-hover`).

## 3. Tests

- [x] 3.1 Add a unit test asserting `--table-stripe` is defined for every theme
  in both modes → verify: test passes.
- [x] 3.2 Confirm the existing "renders GFM table as HTML table" test in
  `MarkdownContent.test.tsx` stays green → verify: `npm test` for that file.

## 4. Visual verification

- [x] 4.1 Rebuild client + restart (`npm run build` → `POST /api/restart`),
  render a chat message with a GFM table, confirm striped rows + separated header
  in at least base/dark and one light theme.

## 5. Validate

- [x] 5.1 `openspec validate markdown-table-styling` passes.
