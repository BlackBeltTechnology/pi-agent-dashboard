# UI plan - harden-server-capability-bounds

Mockup: `index.html` (tokens.css copied from `packages/client/src/index.css`, base dark + light). Design Read profile `product-ui`, redesign mode `preserve`. Revised in planning to match design.md D1-D4 (per-owner cap, no reaper, remote-only browse confinement, no "Request access").

| Surface | Source today | New states | Tokens | Needs |
|---|---|---|---|---|
| A Terminal limit notice | `hooks/useSessionActions.ts` `create_terminal`; terminals view tab bar; inline terminal card | A2 per-owner (identity plane enforced only), A3 global rejection notice | `--severity-warning-{bg,fg,border}` | new WS msg `terminal_limit_reached {scope: "global"\|"owner", limit, cwd, inline}` (server -> requesting socket only); client notice state |
| B Folder picker (remote only) | `components/primitives/PathPicker.tsx` (`error` state) | B1 shared-folder top hint (no `..`), B2 outside-roots refusal (browse + mkdir) | `--severity-error-fg`, `--bg-*`, `--border-*` | browse response `confined?: boolean`; client maps 403 `path outside allowed roots` to B2. Local picker unchanged. |
| B-pin remote pin refused | `browser-handlers/directory-handler.ts` (no feedback) | toast reusing B2 copy ("outside the folders this dashboard shares. Ask the host to pin it.") | `--severity-error-*` | new WS msg `folder_refused {path, reason}` |
| C Recovery refusal | `lifecycle/recovery-server.ts` `buildRecoveryHtml` (inline CSS, no tokens) | C2 refusal callout with remedy | page's own red callout palette | copy + `role="alert"` only |

Dropped in planning: B3 "Request access" (GrantPromptDialog). Local callers are never confined (D1), and a remote device must not grant itself access, so the affordance has no caller. Idle-reaper copy dropped (D3: no reaper).

Checked (revision): contrast AA dark + light (140 text nodes, 0 fails), no horizontal overflow at 375 px and 1280 px. Not run: `score_mockup` (Playwright chromium missing), `validate_mockup`.
