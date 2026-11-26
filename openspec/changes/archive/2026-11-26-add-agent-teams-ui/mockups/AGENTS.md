# DOX — openspec/changes/add-agent-teams-ui/mockups

Live-component mocks for change `add-agent-teams-ui` (tasks 1.1 to 1.8). Site: `npm run mocks` (port 5299, never 8000). One dated dir per page; shared support files are loose (not pages, ignored by `npm run check:mockups`). No production component exists yet (promotion is section 8).

| File | Purpose |
|---|---|
| `2026-11-25-agent-teams-board-mobile/mock.tsx` | DECISION page: phone task board, columns (A) vs grouped list (B). 12 tasks, details open, 50-task stress. Decide with `mock-decide`. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-card-load-look/mock.tsx` | DECISION page: mail card eager (B) vs lazy (A) look. First paint pair plus a played lazy swap. Real `CustomEntryRow`. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-mail-cards/mock.tsx` | Mail cards in the real `ChatView` beside user messages: 11 states, collapsed, expanded, phone, spoofing and markup. Current = host generic card. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-members-cards-vs-table/mock.tsx` | DECISION page: members as cards (A) vs `SettingsTable` (B). 9 members, 10-member stress, phone. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-session-badge/mock.tsx` | DECISION page: badge density on the real `SessionCard` badge slot, compact (A) vs fuller (B). Lead, teammates, long name, plain, cleared stamp. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-team-states/mock.tsx` | Every Team view state of the specs plus stress and long-text fixtures, in the real host shell. No decision. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-team-view-layout/mock.tsx` | DECISION page: desktop layout, three regions (A) vs tabs everywhere (B), lead and teammate session, phone tablist steps, keyboard script. See change: add-agent-teams-ui. |
| `2026-11-25-agent-teams-tool-cards/mock.tsx` | Four tool-card families on the real `ToolCallStep` in running / success / error / elided / foreign-details states. Current = host generic renderer. See change: add-agent-teams-ui. |
| `AGENTS.md` | Per-file record for this dir. See change: add-agent-teams-ui. |
| `teams-cards.tsx` | MOCK-ONLY badge (two densities, `isTeamSession`), `MailEntryCard` on core's `parseEnvelope`, `TeamToolRenderer` family table. Plain-text agent content. See change: add-agent-teams-ui. |
| `teams-fixtures.ts` | Typed fixtures: 9 members in every status, 12 tasks with chains, 40 mail rows, 50 x 10 stress, long text, chat bodies built by core's `formatMail` / `formatNoticeItem`. See change: add-agent-teams-ui. |
| `teams-host.tsx` | MOCK-ONLY host harness: `MockHost` (real primitives + throw-away slot registry), `HostShell` (real `ResizableSidebar` + `SessionCard`s), `ChatPane` (real `ChatView`), `ToolRows` (real `ToolCallStep`), `hostFixtures`. See change: add-agent-teams-ui. |
| `teams-status.tsx` | MOCK-ONLY status table of design D12 (glyph, text, pill state) for member, team and task; pill via `SettingsStatusPill icon={null}`. See change: add-agent-teams-ui. |
| `teams-view.tsx` | MOCK-ONLY Team view: header, banners, members cards / table, task board (stack / columns / grouped), message log, tablist, inline shutdown dialog, states. Variants are props. See change: add-agent-teams-ui. |
| `ui-plan.md` | Surfaces to tokens to states, D12 table, the five decisions with refs, D14 copy defaults, fidelity record, findings, promotion map, verification record. See change: add-agent-teams-ui. |
