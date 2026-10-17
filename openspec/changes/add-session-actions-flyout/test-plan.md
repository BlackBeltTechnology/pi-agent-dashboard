# Test Plan — add-session-actions-flyout

Stage: design (hard gate — 3 clarifications answered, folded into `session-actions-menu` as "Menu follows its session's live state" and "Menu opens within 100 ms")   Generated: 2026-10-17

Levels: L1 = vitest (`packages/*/src/**/__tests__/`, `scripts/__tests__/`); L3 = Playwright (`tests/e2e/*.spec.ts`, docker harness port from `.pi-test-harness.json`). No L2 rows: there is no process/install behaviour.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-actions-menu · fixed taxonomy | EP | L1 | automated | session with OpenSpec attached, worktree, no plugin claims | `deriveSessionMenu` | group ids in order `NEXT,SESSION,OPENSPEC,GIT,VIEW`; no `PLUGINS` group |
| E2 | session-actions-menu · NEXT exactly one | decision-table | L1 | automated | ChangeState ∈ {PLANNING (continue on / off), READY, IMPLEMENTING, COMPLETE (archive on / off)} × ended ∈ {no, yes} | derive | NEXT = Continue / FF / Apply / Apply / Archive change / Verify for live; no NEXT for ended; never more than 1 emphasised item |
| E3 | session-actions-menu · Merge NEXT | decision-table | L1 | automated | worktree, PR open, not draft, checks passing, probed < 15 min, not working, change COMPLETE | derive | NEXT = Merge; OPENSPEC contains non-emphasised **Archive change**; exactly 1 emphasised item |
| E4 | session-actions-menu · More… folding | BVA | L1 | automated | groups with 0, 1, 2, 4 rare items | derive + render | 0 → no expander; 1 → item inline, no expander; 2 → `More…` labelled `2`; 4 → `More…` labelled `4` |
| E5 | session-actions-menu · attachment kinds | EP | L1 | automated | attachment resolves archived (P, D, T) / missing / unresolved / active in main checkout | derive | OPENSPEC = the letter items with archive / preview routes + Detach; no workflow item; no OpenSpec NEXT |
| E6 | session-actions-menu · unattached contents | decision-table | L1 | automated | unattached × status ∈ {active, ended} × completed changes ∈ {0, ≥1} × workflows ∈ {all, core} | derive | active: Attach, New change…, Propose…, Explore… (as workflow config allows); ended: Attach only; Bulk archive… only when ≥1 completed |
| E7 | session-actions-menu · readiness gate | decision-table | L1 | automated | readiness ∈ {GLOBAL_OFF, OPTED_OUT, ABSENT, PENDING, BROKEN, STALE, READY, absent field} × attached ∈ {yes, no} | derive | first 4 → no OPENSPEC group; BROKEN / STALE → only Detach when attached, else none; READY → full; absent field → same as the subcard's legacy degrade |
| E8 | session-actions-menu · Resume/Fork availability | decision-table | L1 | automated | status ∈ {live, ended, hidden} × sessionFile ∈ {set, absent} × origin ∈ {local, remote, ACP} × resuming × cwdMissing | derive | Resume only for ended / hidden + sessionFile + local; Fork for sessionFile + local; `resuming` → both aria-disabled; cwdMissing → aria-disabled with reason "session's directory no longer exists" |
| E9 | session-card-subcards · +Worktree gate | decision-table | L1 | automated | gitWorktreeEnabled ∈ {true, false} × gitWorktree ∈ {set, unset} × isGitRepo ∈ {true, false, undefined} | derive | New worktree session present iff enabled ∧ ¬gitWorktree ∧ isGitRepo ≠ false |
| E10 | session-actions-menu · Rename / Archive / labels | EP | L1 | automated | ended vs live; currentTool set vs unset; attached COMPLETE change | derive | Rename… only when live; Archive session iff the header `canArchive` is true; labels "Archive session" and "Archive change" both present and distinct |
| E11 | worktree-lifecycle · working disables | EP | L1 | automated | worktree session, status streaming / retrying | derive | Push, Open PR, Merge have `disabled` + reason; Close worktree… enabled |
| E12 | session-card-section-visibility · ids → menu | decision-table | L1 | automated | `spawn` hidden; `openspec`, `git` hidden | derive | spawn hidden → no New session / New worktree session; openspec / git hidden → OPENSPEC / GIT menu groups still present |
| E13 | session-actions-menu · VIEW targets | EP | L1 | automated | worktree session (`gitWorktree.mainPath="/repo"`) vs plain session (`cwd="/a"`) | activate Card sections… / Card section defaults… | navigate to `/repo`'s Session cards page / `/a`'s page; defaults → global Settings Session cards |
| E14 | session-actions-menu · inert segments | EP | L1 | automated | attached change with specs skipped, 0 tasks | render menu | Specs (and Archive while not complete) segments have no `role=menuitem`, `tabIndex=-1`, and are skipped by ArrowDown |
| E15 | session-card-subcards · New session payload | EP | L1 | automated | parent `cwd="/project/foo"`, attachedProposal ∈ {"add-dark-mode", null, ""} | activate New session | `spawn_session{cwd:"/project/foo", attachProposal:"add-dark-mode", requestId:UUIDv4}`; for null / "" the `attachProposal` key is absent |
| E16 | session-card-subcards · New worktree dialog path | EP | L1 | automated | attachedProposal ∈ {"add-dark-mode", none} | activate New worktree session | WorktreeSpawnDialog opens for cwd; branch prefilled `os/add-dark-mode` + attachProposal carried / plain path |
| E17 | openspec-attach-combo · Bulk archive in menu | EP | L1 | automated | unattached, cwd `/project/foo`, one completed change | activate Bulk archive… → confirm | confirm dialog "Bulk archive all completed changes?"; send `{type:"openspec_bulk_archive", cwd:"/project/foo"}`; cancel sends nothing |
| E18 | session-card-subcards · condensed card | EP | L1 | automated | fixtures: ended+sessionFile+git, live, worktree, unattached READY, archived attachment | render desktop card | no Resume/Fork/+Session/+Worktree/Apply/OpenSpec `⋯`/legend `⋯`/rename pencil/WorktreeActionsMenu/footer row; Archive, trigger, Exit present; PROCESS row stop / kill and ProcessSafetyChip still render |
| E19 | session-card-subcards · OPENSPEC readiness on card | decision-table | L1 | automated | readiness ∈ {READY attached, READY unattached, BROKEN, absent field} | render desktop card | READY attached → link + lifecycle bar; READY unattached → no OPENSPEC title; BROKEN → remediation control renders; absent field → legacy degrade |
| E20 | session-actions-menu · mirrored status parity | EP | L1 | automated | one attached worktree fixture with a dirty tree and a PR | click stepper Design / change link / branch / dirty pill / PR pill on card; activate matching menu items | identical handler calls (readArtifact(design), open change, switch-branch dialog, commit dialog, PR url) on both surfaces |
| E21 | session-card-subcards · mobile untouched | EP | L1 | automated | `useMobile()=true` | render card | no `session-actions-trigger-*`; mobile snapshot unchanged |
| E22 | openspec-card-section · board row unchanged | EP | L1 | automated | board session row attached to IMPLEMENTING change | render row | Apply primary + `⋯` present; `⋯` lists Explore…, Detach |
| E23 | chat-view · composer ↔ menu parity | decision-table | L1 | automated | same session, each ChangeState × workflow config | derive composer `⋯` and card-menu OPENSPEC | same OpenSpec primary identity; same workflow item set apart from Detach |
| E24 | flows-plugin · actions gate | decision-table | L1 | automated | commandsList ∈ {none published, `flows`, `flows:delete`, `flows:new` only} × flow events ∈ {0, ≥1} × flowsList ∈ {[], [f]} | evaluate action-bar claim gate | open iff (`flows` or `flows:*` other than relying on `flows:new`) ∨ events ≥ 1; closed before first publish; `flows:new` alone has no effect |
| E25 | flows-plugin / session-card-subcards · FLOWS subcard gate | decision-table | L1 | automated | events ∈ {0, ≥1} × editFlow ∈ {on, off} × flowsList ∈ {[], [f]} | evaluate `session-card-flows` predicate | true iff events ≥ 1; FLOWS subcard renders only status (FlowActivityBadge, abort while running) |
| E26 | flow-pre-run-attach · Open flow gate | EP | L1 | automated | flows available × flowsList ∈ {[], [a, b]} × running ∈ {no, yes} | render flows menu claim | hidden for []; enabled for [a, b] not running; disabled with "A flow is running" while running |
| E27 | flows-plugin · manifest + shell isolation | EP | L1 | automated | `packages/flows-plugin/package.json` | parse claims; run `no-flow-references-in-shell.test.ts` | includes `session-card-flows`, `session-card-action-bar`, `content-header-sticky`, 2× `content-view`; excludes `session-card-badge`; shell test passes |
| E28 | overlay-layering · inline zIndex ratchet | BVA | L1 | automated | fixture `.tsx` with `style={{ zIndex: 1000 }}` in client-utils; with `zIndex: "var(--z-popover)"`; `className="z-10"` in client-utils | run extractor | numeric inline flagged in both roots; token not flagged; client-utils class `z-10` not scanned (scope unchanged) |
| E29 | overlay-layering · baseline unchanged | EP | L1 | automated | repo after Popover fix | `node scripts/z-layer-lint.mjs` | no inline occurrences; no entry beyond the pre-existing develop set (AgentSpawnPicker z-30, ChatViewMenu z-40/z-50); baseline file byte-identical |
| E30 | session-actions-menu · trigger glyph | EP | L1 | automated | folder header + worktree session card rendered | read trigger icon paths | session trigger = `mdiDotsVertical` path ≠ folder trigger `mdiFolderCogOutline`; no `mdiDotsHorizontal` menu trigger on the card |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | session-actions-menu · hover off the render path | threshold | L1 | automated | 50 rendered cards; synthetic pointer sweep across every card's body and strip at 1.5 px/ms without dwelling | React Profiler commits = 0 | one sweep (~2 s) |
| P2 | session-actions-menu · open latency | tail-latency | L3 | automated | 50 session cards in the harness | click trigger → panel visible: p95 ≤ 100 ms | 20 opens, closing between |
| P3 | session-actions-menu · reposition without re-render | threshold | L1 | automated | open anchored menu; dispatch 30 scroll events on the sidebar | menu content render count increase = 0; panel `style.top` changes | 30 events |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | session-actions-menu · four entry points | state-transition | L3 | automated | harness session card `s1` (not selected) | click trigger; right-click card body at a point; Shift+F10 with focus on Archive | each opens `session-actions-menu-s1` with identical item ids; trigger `aria-expanded="true"` for the click case; right-click panel top-left at the pointer (clamped); `s1` not selected |
| F2 | session-actions-menu · native menu exemptions | EP | L1 | automated | contextmenu on PR `a[href]`, rename `input`, card text with non-empty selection, during drag | dispatch `contextmenu` | `defaultPrevented=false`; no menu opens |
| F3 | session-actions-menu · keyboard model | state-transition | L1 | automated | menu opened via click (focus on trigger) and via Shift+F10 (focus on Archive) | ArrowDown ×N past end, ArrowUp at start, Home, End, Escape, Tab; opener removed before Escape | wrap at ends; Home / End jump; Escape and Tab close and focus the opener; removed opener → focus on trigger |
| F4 | session-actions-menu · More… expander | state-transition | L1 | automated | OPENSPEC with 4 rare items, focus on item before `More…` | ArrowDown; Enter; ArrowDown; close; reopen | focus lands on `More…` (hidden skipped); Enter reveals 4 and focuses Fast-forward with `aria-expanded="true"`; ArrowDown → Explore…; reopen → collapsed again |
| F5 | session-actions-menu · fast pass-through | fault-free state-transition | L1 | automated | strip 32 px; pointer path through strip toward chat at 1.5 px/ms | pointermove sequence on `document` (fake timers) | no open; filtered |
| F6 | session-actions-menu · dwell opens | BVA | L1 | automated | pointer resting in strip at < 0.4 px/ms for 299 ms / 300 ms | advance timers | 299 ms → closed; 300 ms → open, `document.activeElement` unchanged |
| F7 | session-actions-menu · strip geometry | BVA | L1 | automated | card right edge R; pointer x ∈ {R−33, R−32, R−1}; pointer over the ✕ button inside the band | dwell 300 ms | R−33 → no arm; R−32, R−1 → open; over ✕ → no arm, and ✕ click exits session |
| F8 | session-actions-menu · close grace + bridge | BVA | L1 | automated | hover-opened menu | pointer in gap / over menu (portaled to body) for 1 s; pointer outside all for 299 ms / 301 ms | stays open over gap / menu; 299 ms → open; 301 ms → closed |
| F9 | session-actions-menu · Escape on hover-open | state-transition | L1 | automated | hover-opened menu, focus on an unrelated input | Escape | menu closes; focus still on that input |
| F10 | session-actions-menu · arming suppressed | decision-table | L1 | automated | inline rename active / drag in progress / click-opened menu open / dialog open / `matchMedia(hover:hover and pointer:fine)=false` | dwell 300 ms in strip | no open in every case; on coarse pointer the trigger still opens |
| F11 | session-actions-menu · single open menu across scopes | state-transition | L1 | automated | folder menu `/a` open | open session menu `s1`; then open folder menu `/a` | each opening closes the other; only one `role=menu` in the document |
| F12 | session-actions-menu · placement clamp | BVA | L1 | automated | mocked card rects: room on the right; bottom near the viewport; viewport width − card.right < menu width | open anchored | left = card.right+8 and top = card.top; bottom clamped to viewport−8; overlapping placement clamped to viewport right−8 |
| F13 | session-actions-menu / overlay-layering · scroll tracking | state-transition | L3 | automated | 6+ cards with the sidebar scrollable; menu open via trigger, then via right-click | scroll sidebar 60 px; scroll inside the menu | anchored and point menus stay aligned to the card (Δtop equals Δcard.top ± 1 px); scrolling inside the menu does not move it |
| F14 | overlay-layering · paint order | state-transition | L3 | automated | menu of `s1` overlapping `s2`; then open a dialog | `elementFromPoint` at the overlap; then at the menu centre with the dialog open | overlap point resolves inside the menu; with the dialog open, the point resolves inside the dialog |
| F15 | session-actions-menu · live re-derive | state-convergence | L1 | automated | open menu for idle worktree `s1`, focus on Push | session update → status streaming | menu stays open; Push `aria-disabled="true"`; focus still on Push |
| F16 | session-actions-menu · focused item disappears | state-convergence | L1 | automated | focus on Open PR | update adds `gitPrNumber` (Open PR → View PR #N) | focus moves to the first enabled item |
| F17 | session-actions-menu · card unmounts under menu | state-transition | L1 | automated | open menu of `s1` | `s1` removed from the session list (archived) | menu closes; `document.activeElement` inside the session list region; not `document.body` |
| F18 | session-actions-menu · event containment | EP | L1 | automated | open menu | click / contextmenu / Shift+F10 keydown on a menu item | card `onSelect`, contextmenu and keydown handlers not invoked; menu not reopened or moved |
| F19 | session-actions-menu · plugin output hosting | EP | L1 | automated | action-bar claims: one rendering a button, one rendering `null`; `actionbar-<id>` filter hiding one plugin | close / open menu; click the claim button | output absent from the card DOM; present inside a labelled `role=group` when open; heading hidden when only the null claim; filtered plugin absent; click closes the menu, card not selected |
| F20 | session-actions-menu / flows-plugin · claim lifecycle | state-transition | L1 | automated | flows available, edit mode on; menu never opened | mount the card | edit-mode reconcile `flow_management{set-edit-mode}` dispatched exactly once |
| F21 | session-actions-menu · claim-owned dialog survives close | state-transition | L3 | automated | harness session with ≥1 flow | open menu → Run Flow… | menu closes; the Run Flow dialog is visible and stays open for 2 s |
| F22 | session-actions-menu · intent action list as menuitems | EP | L1 | automated | `ui:action-list` intent with 2 actions on `session-card-action-bar` | open menu; activate action 1 | 2 `role=menuitem`; activation dispatches the action descriptor and closes the menu |
| F23 | overlay-layering · popover inside dialog | state-transition | L3 | automated | dialog with a control opening a `ui:popover` | open popover; click an item | popover above the backdrop (`elementFromPoint`); dialog stays open after the click |
| F24 | overlay-layering · dialog over popover | state-transition | L3 | automated | `ui:popover` open outside dialogs | open a modal dialog over it | dialog resolves at the overlap point; computed popover z-index = `var(--z-popover)` value 40 |
| F25 | session-actions-menu · visual polish | visual/subjective | — | manual-only | menu in studio dark + light at 220 / 300 / 500 px sidebar | human review | [judgment: NEXT emphasis, sticky headings, group spacing read clearly — no automatable observable] |
| F26 | session-actions-menu · hover feel in real use | visual/subjective | — | manual-only | real mouse, 20 sweeps from cards into the chat | human review using the mockup lab counters | [judgment: accidental opens feel rare, dwell not sluggish — informs timing retune] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-actions-menu · plugin isolation | fault-injection (abort) | L1 | automated | action-bar claim component throws on render | open menu | host groups render; per-claim error boundary contains the failure; no uncaught error; session list keeps rendering |
| X2 | session-actions-menu · disabled item inert | EP | L1 | automated | Fork disabled by cwdMissing | click / Enter on Fork | no fork request sent; menu stays open; reason text exposed |
| X3 | session-actions-menu · goal claim in menu | EP | L1 | automated | goal-linked session | open menu; activate Pause; activate Open | Pause sends `plugin_action` `/goal …`; Open navigates to the goal detail route; GoalChip still renders in STATUS on the card |
| X4 | session-actions-menu · dialog after select | state-transition | L1 | automated | open menu → Explore… | Escape inside ExploreDialog | dialog closes; menu does not reopen; focus returns to the card trigger |

---

## Coverage summary

- Requirements covered: 41/41 delta requirements (session-actions-menu 12, session-card-subcards 8, openspec-attach-combo 5, openspec-card-section 1, worktree-lifecycle 1, session-card-section-visibility 2, overlay-layering 2, dashboard-shell-slots 1, flow-pre-run-attach 1 (+1 removed), flows-plugin 2 (+1 removed), chat-view 1, sleek-card-design 2 removed, verified by E18's no-footer-row assertion)
- Scenarios by class: edge 30 · perf 3 · frontend 26 · error 4
- Scenarios by level: L1 54 · L2 0 · L3 7 · manual 2
- Scenarios by disposition: automated 61 · manual-only 2

## New infra needed

- none. L3 rows extend the existing docker harness; P2 needs a 50-session fixture seeded the way `tests/e2e/folder-actions-menu.spec.ts` seeds sessions.
