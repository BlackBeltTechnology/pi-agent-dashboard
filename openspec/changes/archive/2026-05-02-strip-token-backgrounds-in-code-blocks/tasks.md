## Tasks

- [x] 1. Extend `getSyntaxTheme()` to strip token backgrounds
  - [x] 1.1 Add a pure helper `stripTokenBackgrounds(style)` in
        `packages/client/src/lib/syntax-theme.ts` that returns a clone of the
        prism style with `background` / `backgroundColor` removed from every
        selector whose key contains `.token`.
  - [x] 1.2 Wire `getSyntaxTheme()` to apply `stripTokenBackgrounds()` to
        the resolved prism style before returning (also on the fallback
        path that returns `oneLight` / `oneDark` directly).

- [x] 1b. **Follow-up: also strip the inner `code` wrapper background**
      (post-implementation, the original strip missed this and simple
      syntax-highlighted code blocks still show the prism palette's stock
      panel color behind characters).
  - [x] 1b.1 In `stripTokenBackgrounds()`, also delete `background` /
        `backgroundColor` when the selector key is exactly
        `code[class*="language-"]`. Leave `pre[class*="language-"]`
        intact (safety-net default).
  - [x] 1b.2 Extend the unit test: `code[class*="language-"]` has no
        `background` / `backgroundColor` property after the strip; AND
        `pre[class*="language-"]` still has its original `background`
        property.
  - [x] 1b.3 Visual smoke: open chat, send a fenced ```ts code block;
        confirm the panel uses `var(--bg-code)` and no opaque inner-code
        background paints over it. Repeat under `dracula`, `nord`,
        `github`, `catppuccin` themes.

- [x] 2. Migrate `DiffPanel` "File" view onto `getSyntaxTheme()`
  - [x] 2.1 Import `useThemeContext` and `getSyntaxTheme` in
        `packages/client/src/components/DiffPanel.tsx`.
  - [x] 2.2 Remove the raw `oneDark` import.
  - [x] 2.3 Replace `style={oneDark}` on the File-view `<SyntaxHighlighter>`
        with `style={getSyntaxTheme(theme, themeName)}` resolved from the
        theme context.

- [x] 3. Test: token-background strip
  - [x] 3.1 Add (or extend) a unit test in
        `packages/client/src/lib/__tests__/syntax-theme.test.ts` that
        invokes `getSyntaxTheme("dark", "base")` and asserts: every key
        containing `.token` has no `background` / `backgroundColor`.
  - [x] 3.2 Repeat the assertion for `("dark", "dracula")`,
        `("dark", "nord")`, `("dark", "github")`, `("dark", "catppuccin")`,
        and the light counterparts.
  - [x] 3.3 Add a sibling assertion that `pre[class*="language-"]` retains
        its original `background` value (the wrapper is NOT stripped).
  - [x] 3.4 Pin diff washes: `.token.deleted` and `.token.inserted` have no
        `background*` property after the strip.

- [x] 4. Visual smoke (manual, post-implementation)
  - [x] 4.1 Open the dashboard in dev mode under the default ("base") theme.
  - [x] 4.2 Send a chat message containing a fenced ```diff block with
        added/removed lines; confirm no red/green per-line pills inside
        characters.
  - [x] 4.3 Open a `Read` tool result for any `.ts` file; confirm the panel
        bg is `--bg-code` and tokens carry no per-character pills.
  - [x] 4.4 Open the diff/file view (`/api/session-diff`) for a session
        with file edits; switch to "File" view; confirm tokens have no
        per-character pills and that switching to a different theme
        retints the code.

- [x] 5. Documentation
  - [x] 5.1 Update the `packages/client/src/lib/syntax-theme.ts` entry in
        `AGENTS.md` (Key Files) noting the token-background strip and the
        DiffPanel File-view migration; cite this change name.
  - [x] 5.2 Note the same in `packages/client/src/components/DiffPanel.tsx`'s
        AGENTS.md row.

- [x] 6. Bind `<DiffView>`'s `diffViewTheme` to the active app theme
  - [x] 6.1 In `packages/client/src/components/DiffPanel.tsx`, replace
        `diffViewTheme="dark"` on the `<DiffView>` element with
        `diffViewTheme={theme === "light" ? "light" : "dark"}` using the
        `theme` already captured from `useThemeContext()` for task 2.
  - [x] 6.2 Confirm no other call site renders `<DiffView>` (it is only
        used in this component); if a future site appears, route it
        through the same hook.

- [x] 7. Test: diff view theme tracking
  - [x] 7.1 Add a render test (or extend `ToolRendererTheme.test.tsx`-style
        coverage) that mounts `<DiffPanel>` with a `ThemeProvider` set to
        light and asserts the rendered `<DiffView>` receives
        `diffViewTheme="light"`; flip the provider to dark and assert
        `"dark"`. Mock `<DiffView>` to capture the prop, mirroring the
        existing `MockedSyntaxHighlighter` pattern.

- [x] 8. Visual smoke (manual)
  - [x] 8.1 Open a session with file edits and trigger the diff/file view.
  - [x] 8.2 With the diff view rendering, toggle the app theme between
        light and dark; confirm `<DiffView>`'s background, gutter, and
        hunk header chrome re-theme on every toggle.

- [x] 9. Documentation
  - [x] 9.1 Update the `packages/client/src/components/DiffPanel.tsx`
        AGENTS.md row to also note the `diffViewTheme` binding (in
        addition to the File-view migration already documented).
