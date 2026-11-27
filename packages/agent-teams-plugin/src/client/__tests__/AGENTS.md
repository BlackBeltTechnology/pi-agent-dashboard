# DOX — packages/agent-teams-plugin/src/client/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `announcements.test.ts` | S30 / 13.19: snapshot diff + throttled announcer (0 / 3 999 / 4 000 ms), no text in events. See change: add-agent-teams-ui. |
| `announcements.test.tsx` | Live region inside the real view (S91, S61): exists before the first change, baseline silent, ≤ 1 summary / 4 s, no text; peer payloads literal. See change: add-agent-teams-ui. |
| `doorbell-accumulation.test.ts` | S77 / task 10.2: 7 200 frames — last append ≤ 5 ms, total ≤ 2 s; busy 2 h refetch rate, never overlapping. Prints numbers. See change: add-agent-teams-ui. |
| `fixtures.ts` | `makeSnapshot(spec)` typed `TeamUiSnapshot` builder. Not a test. See change: add-agent-teams-ui. |
| `format-cwd.test.ts` | S14 folder display (whole-segment prefix, Windows drive case). See change: add-agent-teams-ui. |
| `host-event-group.test.tsx` | S88: hidden `other` group hides mail cards via the real `CustomEntryRow`; Team view log still lists all mail. See change: add-agent-teams-ui. |
| `host-row.tsx` | Helper: REAL reducer builds the custom row, REAL `CustomEntryRow` mounts the claim (loaded by path). `rowOf`, `reduceCustom`, `hostRows`, `teamRegistry`. See change: add-agent-teams-ui. |
| `i18n.test.ts` | Catalog parity (S132) + eager catalog = badge keys only (S101); client barrel exports `catalog`, `TeamBadge`, `isTeamSession` only. See change: add-agent-teams-core, add-agent-teams-ui. Also: key + placeholder parity of `START_TABLES` / `APPROVAL_TABLES` (F8). See change: add-agent-teams-templates-hooks. |
| `i18n.test.tsx` | S101: 3 locales × 3 lazy tables (key sets, placeholders, translated), fallback to `en`, referenced keys exist, tables stay with their module, render under each locale. See change: add-agent-teams-ui. Also: the two templates-hooks tables (3 locales). See change: add-agent-teams-templates-hooks. |
| `lazy-cards.test.tsx` | S84 / S86 in the real `CustomEntryRow`: 7 s chunk delay → generic card then swap (one row, never blank); throwing card → host fallback, other rows fine. See change: add-agent-teams-ui. |
| `mail-card-notice-contract.test.tsx` | S63: core's REAL notice builder → reducer → card keeps peer fake items inside their item; asserted marker fallback. See change: add-agent-teams-ui. |
| `mail-card.fuzz.test.tsx` | S74: 10 000 random bodies never throw / always render text / never build elements; parse op count ≤ 4× length and linear. See change: add-agent-teams-ui. |
| `mail-card.reducer.test.tsx` | S1, S4, S5, S87, S89 through the REAL reducer + `CustomEntryRow`: every core kind × urgent, 200-line and 64 000-char header cuts, no request / payload ignored, batched mails. See change: add-agent-teams-ui. |
| `mail-card.test.tsx` | S2, S3, S6–S9, S60, S62, S64: sender classes, open kind set (core limits), offset-0 header, notice grouping, idle + expansion, inert text, spoofing, role look-alikes. See change: add-agent-teams-ui. |
| `mail-fixtures.ts` | `header(kind, sender, urgent)`: an envelope line without core validation (hostile headers). See change: add-agent-teams-ui. |
| `mail-parse.contract.test.ts` | Task 2.3: core `formatMail`/`formatEnvelope`/`formatNoticeItem` → REAL client reducer (`pi.sendMessage` arm, loaded by path) → `parseMailBody`/`parseNoticeItems`; kinds × urgent, unknown kind, notices, 199/200/201 lines, 63 999/64 000/64 001 chars, offset 0, CRLF, sender/kind grammar. See change: add-agent-teams-ui. |
| `members-grid.test.tsx` | S15, S12, S121, S61, S118, S37: current task / "+N more", status ids, folder, Stop rules + inline notes, degraded member, inert text. See change: add-agent-teams-ui. |
| `message-log.test.tsx` | S18, S19, S120, S122, S61: filters (broadcast rule), rows, generic kinds, tail indicator, follow-newest 8 px. See change: add-agent-teams-ui. |
| `status-map.test.ts` | S12 / 13.11: every status → glyph, text key, pill state; distinct glyphs; unknown fallback. See change: add-agent-teams-ui. |
| `task-board.perf.test.tsx` | S78 (structural): 304 ⇒ 0 re-renders / 0 DOM mutations, one member change ⇒ one row, memo gates by value, snapshot ≤ 384 KiB; wall-clock printed, not gated. See change: add-agent-teams-ui. |
| `task-board.test.tsx` | S16, S17, S61: deps / blocked (server flag), counts, empty, disclosure mounting, read-only, owner filter, grouped narrow layout, focus. See change: add-agent-teams-ui. |
| `team-badge.test.tsx` | S13/S73/S90 unit: `isTeamSession` decision table; `TeamBadge` link, aria name, focus, hostile ids, live appear/disappear. See change: add-agent-teams-ui. |
| `team-controls.test.tsx` | S102, S109–S112: confirm dialog flow, one POST, 403 / 409 / 404 inline notes, 15 s stall, connection drop. See change: add-agent-teams-ui. |
| `team-header.test.tsx` | S37, S118, S121: control matrix (status × control × persist_degraded), notices, mode/parallel ids, Back. See change: add-agent-teams-ui. |
| `team-view-harness.tsx` | Helper: scriptable fake server behind `fetch` (lookup, ETag/304, 404, POSTs), `mountView`, `flush`. See change: add-agent-teams-ui. |
| `team-view-state.test.tsx` | S92: disclosure / filter / focus / tab survive a refetch; moved task keeps disclosure; vanished member resets the filter; cross-links. See change: add-agent-teams-ui. |
| `team-view-remount.test.tsx` | S97: selected tab restored when the claim remounts under a different parent (shell layout swap). See change: add-agent-teams-ui. |
| `team-view-states.test.tsx` | S38: loading (`aria-busy`), no team, not found, error ± cache, empty sections. See change: add-agent-teams-ui. |
| `team-view-tabs.test.tsx` | S36: APG tablist keys, wrap, roving tabindex, panel wiring. See change: add-agent-teams-ui. |
| `team-view-testids.test.tsx` | S121: change-5 `data-testid` contract, independent of language. See change: add-agent-teams-ui. |
| `teams-feeder.test.tsx` | Feeder (S48, S57, S31/S50 wiring): StrictMode single GET, reset ≠ state change, frames, reconnect, teammate view subscribes to the lead's frames from the lookup `leadSessionId`. See change: add-agent-teams-ui. |
| `teams-store.replay.test.tsx` | S50: 7 200 replayed frames + flapping socket ≤ 1 GET, no re-render storm. See change: add-agent-teams-ui. |
| `teams-store.test.ts` | S31–S34, S39, S47, S54, S58, S75, S81, S107, S108 + 404 + lifecycle + control POST timeout. Fake timers, scripted fetch. See change: add-agent-teams-ui. |
| `tool-renderers.test.tsx` | S10, S60: 11 tools × details classes never blank, error sentences / verbatim unknown code, 50-task list, inert text, single encoded link. See change: add-agent-teams-ui. |
| `view-fixtures.tsx` | Builders `member`, `task`, `mail`, `snap` and `renderHost` (real primitive provider + fake `ui:confirm-dialog`). See change: add-agent-teams-ui. |
| `cards.test.tsx` | Approval + playbook cards (#S9, #F6, #F7): only the server header is parsed, posted `planId` is the header's, peer text never becomes controls/markup, non-control cards, collapsed playbook. See change: add-agent-teams-templates-hooks. |
| `folder-section.test.tsx` | #F10: ONE Start item per folder, sidebar placement only; dialog posts the folder cwd. See change: add-agent-teams-templates-hooks. |
| `start-dialog.test.tsx` | StartTeamDialog (#F1–#F3, #F8, S15): list states, hook confirmation with shown hash, one POST in flight, error + retry, Esc/✕, commands as literal text, no raw key. See change: add-agent-teams-templates-hooks. |
