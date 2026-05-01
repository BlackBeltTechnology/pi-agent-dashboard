## Tasks

- [ ] 1. Extend `getSyntaxTheme()` to strip token backgrounds
  - [ ] 1.1 Add a pure helper `stripTokenBackgrounds(style)` in
        `packages/client/src/lib/syntax-theme.ts` that returns a clone of the
        prism style with `background` / `backgroundColor` removed from every
        selector whose key contains `.token`.
  - [ ] 1.2 Wire `getSyntaxTheme()` to apply `stripTokenBackgrounds()` to
        the resolved prism style before returning (also on the fallback
        path that returns `oneLight` / `oneDark` directly).

- [ ] 2. Migrate `DiffPanel` "File" view onto `getSyntaxTheme()`
  - [ ] 2.1 Import `useThemeContext` and `getSyntaxTheme` in
        `packages/client/src/components/DiffPanel.tsx`.
  - [ ] 2.2 Remove the raw `oneDark` import.
  - [ ] 2.3 Replace `style={oneDark}` on the File-view `<SyntaxHighlighter>`
        with `style={getSyntaxTheme(theme, themeName)}` resolved from the
        theme context.

- [ ] 3. Test: token-background strip
  - [ ] 3.1 Add (or extend) a unit test in
        `packages/client/src/lib/__tests__/syntax-theme.test.ts` that
        invokes `getSyntaxTheme("dark", "base")` and asserts: every key
        containing `.token` has no `background` / `backgroundColor`.
  - [ ] 3.2 Repeat the assertion for `("dark", "dracula")`,
        `("dark", "nord")`, `("dark", "github")`, `("dark", "catppuccin")`,
        and the light counterparts.
  - [ ] 3.3 Add a sibling assertion that `pre[class*="language-"]` retains
        its original `background` value (the wrapper is NOT stripped).
  - [ ] 3.4 Pin diff washes: `.token.deleted` and `.token.inserted` have no
        `background*` property after the strip.

- [ ] 4. Visual smoke (manual, post-implementation)
  - [ ] 4.1 Open the dashboard in dev mode under the default ("base") theme.
  - [ ] 4.2 Send a chat message containing a fenced ```diff block with
        added/removed lines; confirm no red/green per-line pills inside
        characters.
  - [ ] 4.3 Open a `Read` tool result for any `.ts` file; confirm the panel
        bg is `--bg-code` and tokens carry no per-character pills.
  - [ ] 4.4 Open the diff/file view (`/api/session-diff`) for a session
        with file edits; switch to "File" view; confirm tokens have no
        per-character pills and that switching to a different theme
        retints the code.

- [ ] 5. Documentation
  - [ ] 5.1 Update the `packages/client/src/lib/syntax-theme.ts` entry in
        `AGENTS.md` (Key Files) noting the token-background strip and the
        DiffPanel File-view migration; cite this change name.
  - [ ] 5.2 Note the same in `packages/client/src/components/DiffPanel.tsx`'s
        AGENTS.md row.
