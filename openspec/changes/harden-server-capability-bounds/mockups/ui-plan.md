# UI plan - harden-server-capability-bounds

Mockup: `index.html` (tokens.css copied from `packages/client/src/index.css`, base dark + light). Design Read profile `product-ui`, redesign mode `preserve`.

| Surface | Source today | New states | Tokens | Needs |
|---|---|---|---|---|
| A Terminal limit notice | `hooks/useSessionActions.ts` `create_terminal`; terminals view tab bar | A2 per-folder, A3 global rejection notice | `--severity-warning-{bg,fg,border}` | new WS msg `terminal_limit_reached {scope, limit}` (server -> browser); client notice state |
| B Folder picker | `components/primitives/PathPicker.tsx` (`error`, `denial` states) | B1 root hint (no `..`), B2 outside-roots refusal, B3 "Request access" via `GrantPromptDialog` cwd plane, B4 remote refusal | `--severity-error-fg`, `--severity-info-*`, `--bg-*`, `--border-*` | client maps 403 `path outside allowed roots`; B3 needs a server grant request on refused browse (spec change); host-local gate for B3 |
| C Recovery refusal | `lifecycle/recovery-server.ts` `buildRecoveryHtml` (inline CSS, no tokens) | C2 refusal callout with remedy | page's own red callout palette | copy + `role="alert"` only |

Checked: contrast AA dark + light (146 text nodes, 0 fails), no horizontal overflow at 375 px and 1280 px, touch targets >= 44 px at 375 px. Not run: `score_mockup` (Playwright chromium missing), `validate_mockup`.
