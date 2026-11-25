# DOX — packages/agent-teams-plugin/src/client/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `announcements.test.ts` | S30 / 13.19: snapshot diff + throttled announcer (0 / 3 999 / 4 000 ms), no text in events. See change: add-agent-teams-ui. |
| `fixtures.ts` | `makeSnapshot(spec)` typed `TeamUiSnapshot` builder. Not a test. See change: add-agent-teams-ui. |
| `i18n.test.ts` | Catalog parity (S132) + eager catalog = badge keys only (S101); client barrel exports `catalog`, `TeamBadge`, `isTeamSession` only. See change: add-agent-teams-core, add-agent-teams-ui. |
| `mail-parse.contract.test.ts` | Task 2.3: core `formatMail`/`formatEnvelope`/`formatNoticeItem` → REAL client reducer (`pi.sendMessage` arm, loaded by path) → `parseMailBody`/`parseNoticeItems`; kinds × urgent, unknown kind, notices, 199/200/201 lines, 63 999/64 000/64 001 chars, offset 0, CRLF, sender/kind grammar. See change: add-agent-teams-ui. |
| `status-map.test.ts` | S12 / 13.11: every status → glyph, text key, pill state; distinct glyphs; unknown fallback. See change: add-agent-teams-ui. |
| `team-badge.test.tsx` | S13/S73/S90 unit: `isTeamSession` decision table; `TeamBadge` link, aria name, focus, hostile ids, live appear/disappear. See change: add-agent-teams-ui. |
| `teams-feeder.test.tsx` | S48 StrictMode (1 GET, 1 timer, 1 listener, clean unmount), frames, reconnect, events reset ≠ state change (S57). See change: add-agent-teams-ui. |
| `teams-store.replay.test.tsx` | S50: 7 200 replayed frames + flapping socket ≤ 1 GET, no re-render storm. See change: add-agent-teams-ui. |
| `teams-store.test.ts` | S31–S34, S39, S47, S54, S58, S75, S81, S107, S108 + 404 + lifecycle + control POST timeout. Fake timers, scripted fetch. See change: add-agent-teams-ui. |
