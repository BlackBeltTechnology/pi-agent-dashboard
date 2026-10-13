# UI plan: folder MCP page, per-project overrides

Surface: `/folder/:encodedCwd/mcp` (`FolderMcpPage.tsx` → `ServerList.tsx` rows). Redesign mode: **preserve** (anti-slop-redesign). Existing `data-testid`s, the row layout, provenance badges, live cell, editor dialog and undo toast stay. New controls are added inside the existing row grammar.

## Protected (do not change)
- Row root `li` + `flex items-center gap-2 min-h-11 sm:min-h-0` and the switch `role="switch"` with `aria-label="Enable <name>"`.
- Badges `Pi global` / `Pi folder` / `overrides Pi global`, the live cell, `sign in: /mcp login <name>`, and the leftovers Convert.
- `mcp-folder-*` / `mcp-server-*` testids. The row action button stays at `ml-auto`.

## Surfaces → tokens → states

| Surface | Tokens (ui-contract roles) | States |
|---|---|---|
| Folder badge ("Off in this folder", "On in this folder", "Exposure: direct in this folder") | chip recipe: `rounded-full px-1.5 py-0.5 text-[11px]`; tint triple `--tint-blue-{bg,fg,border}` (an identity pill, not a severity) | hidden (Inherit) · one badge per overridden key |
| Reset to global (inline text button) | `--accent-text` link colour, focus ring, `min-h-11 sm:min-h-0` | desktop inline · mobile in sheet only |
| Row overflow ("⋯") → Project settings… / Replace with folder entry… | secondary button recipe | menu closed/open |
| Project settings panel | dialog recipe (scrim `--bg-overlay`, card `--bg-secondary`, `--border-secondary`); field label `text-[12px] font-semibold --text-primary`; segmented radiogroup on `--bg-tertiary`, selected `--accent-soft` + `--text-primary` + `--accent` border; select = input recipe; primary button `--accent-solid` | Inherit/On/Off selected · exposure inherit/explicit · toolExposure read-only list · saving · error |
| Untrusted note | severity-warning triple `--severity-warning-{bg,fg,border}` + word "Not trusted" | pending ("applies once the project is trusted") |
| Legacy copy strip | severity-info triple + text | shown with Convert / after convert (undo toast) |
| Orphaned or invalid override row | severity-error fg for pi's message (`--severity-error-fg`) + word; switch disabled; Remove = secondary button | shown |
| Undo toast | existing `mcp-folder-undo-toast` | Reset / Remove / Convert |
| Mobile < 640 px | bottom sheet = dialog recipe anchored bottom, `rounded-t-xl`; every action `min-h-[44px]` | badges display-only, actions in the row sheet |

## Cited rules
- Nielsen #1 visibility of system status: the badge text says what this folder changes, and the untrusted note explains a switch that seems not to take effect.
- Nielsen #3 user control and freedom: Reset, Remove and Convert all have undo.
- Nielsen #5 error prevention: Convert is offered only for exact copies, and the switch is disabled on orphaned rows.
- WCAG 1.4.1 use of colour: every state carries a word, never colour only. WCAG 2.5.8: the repo floor is 44px below 640px (stricter than 24px). WCAG 2.1.1: the radiogroup uses arrow keys (native radios).
- Hick's law: the row stays one switch plus one overflow. Rarer actions sit in the overflow and panel.
- GOV.UK "radios": three mutually exclusive options with visible labels, rather than a tri-state checkbox.

## Mockup and verification

- Mockup: `mcp-project-override/index.html` (static, tokens copied from `packages/client/src/index.css`). Theme and trust toggles are in the header. Screenshots are in `mcp-project-override/screenshots/` (dark and light at 375 and 1280, page and panel).
- Implementation note: when the panel opens, focus goes to the **checked** radio (`autofocus` in the mockup), not the first option.

| Rubric (frontend-mockup-loop) | Result |
|---|---|
| Contrast WCAG AA, both themes | PASS. Lowest text pair 5.17:1 (primary button). Badges 7.30 / 6.97, warning note 7.77 / 6.13, error message 8.46 / 8.84, links 7.25 / 6.42 (dark / light), measured in Chrome |
| Responsive | PASS. No horizontal overflow at 375 / 1280. Every visible control ≥ 44×44 below 640 px. The panel becomes a bottom sheet. |
| Hierarchy | PASS. The switch and name lead the row; badges and Reset are secondary; rare actions sit in the overflow |
| Spacing | PASS. 4/6/8/12/16 px steps from the contract scale |
| Token fidelity | PASS. Every colour is a contract token (severity and tint families, `--accent-text`, `--accent-solid` + white per contract). Menu and toast shadows use the raised-elevation recipe. |
| Anti-slop | PASS. Product-UI profile, preserved row grammar, no decorative gradients or eyebrows, real server names |
| Console | PASS. Only a favicon 404 (static server) |
