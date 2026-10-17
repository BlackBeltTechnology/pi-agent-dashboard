# Browser relay — retro UX audit

Board: `relay.html`. Sources: `packages/browser-plugin/src/client/*.tsx`, `ConfirmRenderer.tsx`.

## Probe (tests/e2e/helpers/computed-contrast.ts — contrast + size + focus)

| Theme | As-built | Proposed |
|---|---|---|
| base dark | 36 | 0 |
| base light | 36 | 0 |
| nord dark | 36 | 0 |

## Findings

- S1 profile status = 3 × 10 px tertiary lines, no icon/tone.
- S2 Connect disabled with no reason (only the kill-switch case explains itself).
- S3 token input labelled only by its placeholder.
- S4 instance row shows only "N tabs".
- S5 audit always expanded; raw kind ids; 10–11 px; `denied` not highlighted.
- S6 allowed domains saved on blur with no feedback; "empty = any domain" never stated.
- S7 global kill switch = bare "Enabled" checkbox.
- B1 `browser_relay_status` has no owner session → every session card shows the same badge.
- B2 badge text is 10 px, no icon. B3 tab state = colour-only 6 px dot (WCAG 1.4.1). B4 menu uses the URL as the title; "Open in pane" repeated on every row.
- P1 Input/Fit labels show state, not action; nothing shows that clicks reach the page. P2 tab-strip state is colour only.
- P3 idle strip 11 px tertiary; last frame not dimmed. P4 DevTools/no-session overlays = one 11 px sentence, no next step.
- P5 waiting/agent-capturing = 11 px text, top-left. P6 text bridge disabled with no reason. P7 gone = bare sentence.
- T1 Done ✓ is the 4th 12 px toolbar button. T2 chat card is generic Yes/No/Cancel ("No" means nothing here). T3 only feedback after Done is 50 % opacity.

## Approval (2026-10-14)

User approved all five directions: S, B1, B2–B4, P, T.
B1 needs server data (owner session per instance/tab), so it means a protocol change, not only a client change.
T needs `ConfirmRenderer` to pick a renderer by `_pluginMeta.kind === "browser-takeover"`. The pane's Cancel needs to answer `false` (today the pane only answers `true`).
