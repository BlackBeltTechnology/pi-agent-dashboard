> Phased so each phase can ship independently: **A** (1–6) block toggles + effects, **B** (7–8) Focus mode, **C** (9–11) accordion. Supersedes `focus-driven-folder-compaction`.

## 1. Shared model + resolver (Phase A)

- [x] 1.1 In `packages/shared/src/card-sections.ts` add ids `openspec-badge`, `folder-git`, `folder-banner`, `folder-openspec`, `folder-create`, `folder-ended`, `fx-status-animation`, `fx-selected-glow`; add `pluginSectionId(kind: "badge" | "actionbar" | "pill", pluginId)` returning `null` for invalid results; add `parentOf(id)`. Verify: unit tests for id derivation (valid, invalid plugin id → null).
- [x] 1.2 Extend `CardSectionPrefs` with `focus?` (design D1) and implement the precedence of design D2; `fx-*` ids ignore folder overrides in `resolveCardSectionVisible` (focus → folder → global → parent → visible). Verify: table-driven tests covering every `Visibility resolution order` scenario in `specs/session-card-section-visibility`, incl. legacy parent and child-overrides-parent.
- [x] 1.3 Add `DEFAULT_FOCUS_PROFILE` + rule for `badge-*` / `actionbar-*` / `pill-*` ids and `resolveFolderListMode(prefs, config)`. Verify: tests for built-in profile (process not set, fx off, accordion) and profile override of folder list mode.

## 2. Server store, validation, protocol (Phase A/B)

- [x] 2.1 `preferences-store.ts`: carry `cardSections.focus` through load sanitize (~L430), `cardSectionsSnapshot` (~L437) and `cardSectionsForDisk`; enforce `FOCUS_PROFILE_MAX_KEYS = 256`. Verify: store tests for round-trip, sanitize garbage, cap rejection without mutation.
- [x] 2.2 `preferences-store.ts`: new top-level `expandedFolders` next to `collapsedFolders` (both write literals ~L633/L645), canonical keys, never pruned for missing sessions; pin clears collapsed and collapse clears pin. Verify: store tests for persistence and the mutual-exclusion invariant.
- [x] 2.3 `browser-protocol.ts`: add `set_focus_mode`, `set_focus_profile`, `set_folder_expanded`; snapshot `card_sections_updated` carries the extended record. Register the new types in `identity/ws-message-scope.ts` and `identity/ws-road-classification.ts`. Verify: protocol/scope tests list the new types.
- [x] 2.4 `browser-gateway.ts` / `directory-handler.ts` routing + validation per `Focus state validation` (malformed id, non-boolean, bad enum, >256 profile keys → no change, no broadcast) and reject folder-scoped writes for `fx-*` ids (`card-visual-effects`). Verify: gateway tests for each rejection and for broadcast to all browsers on success.

## 3. Plugin slot filtering (Phase A)

- [x] 3.1 `dashboard-plugin-runtime/src/slot-consumers.tsx`: optional `isPluginVisible?(pluginId)` on `SessionCardBadgeSlot`, `SessionCardActionBarSlot`, `SidebarFolderSectionSlot`, filtering legacy claims and intents; export a matching has-visible-claims helper. Verify: runtime tests — hidden plugin's claim and intent not rendered, others rendered, prop absent = unchanged.
- [x] 3.2 Client hook `usePluginSectionFilter(kind, folderKey)` built on `CardSectionsContext`. Verify: hook unit test.

## 4. Session card (Phase A)

- [x] 4.1 `SessionCard.tsx` desktop + mobile: `openspec-badge` gates `OpenSpecActivityBadge` and the mobile attached chip; `openspec` gates only the subcard; drop `phase` from `TagStrip` and render the strip only when user tags exist. Verify: component tests for `OpenSpec phase shown once` scenarios on both branches.
- [x] 4.2 Wire `badge-*` filter into `BadgeSubcard` (no empty STATUS frame when all hidden) and `actionbar-*` into `SessionCardActionBarSlot`. Verify: test `Per-plugin badge switch` scenario.

## 5. Directory card (Phase A)

- [x] 5.1 `SessionList.tsx`: gate `GroupGitInfo` (keep group-by chip), `FolderOpenSpecSection`, pill grid via `pill-*` filter (omit grid when empty), CREATE divider + `FolderSpawnButtons` + SESSIONS divider, `EndedExpanderRow` per design D4. Verify: component tests for `Minimal directory card` and `Ended row hidden`.
- [x] 5.2 `FolderActionBanner` compact chip mode + per-tab reveal. Verify: tests for both `Folder banner safety chip` scenarios.

## 6. Effects + settings UI (Phase A)

- [x] 6.1 Root `data-fx-status` / `data-fx-glow` attributes from resolved values; `index.css` static tints (yellow / cyan / purple, matching `card-stripes-running|unread|input`) and static selected border; `SessionCard` skips FX layers + `useFxVisibility` when off. Verify: tests per `card-visual-effects`, `ask-user-card-indicator` and `ui-animation-energy` delta scenarios; manual check under reduced motion.
- [x] 6.2 `card-section-meta.ts`: rows for new ids; per-plugin rows generated from registry claims per slot (plugin display name); groups Session card / Directory card / Effects. Verify: meta tests — plugin rows only when a claim exists.
- [x] 6.3 `CardSectionsPage.tsx` (folder; no Effects group) and `settings/CardSectionsSection.tsx` (global, with Effects) render the new groups, inherited-from-parent `Default (…)` label, override counts. Verify: component tests for `Directory-card rows listed`, `Directory-card switch applies everywhere`.
- [x] 6.4 i18n keys (en + hu) for all new labels/descriptions. Verify: i18n key-parity test passes.

## 7. Focus mode core (Phase B)

- [x] 7.1 `CardSectionsContext`: expose focus state + actions `setFocusEnabled`, `saveCurrentAsFocusProfile`, `setFocusProfileRow`, `resetFocusProfile`. First row edit while the built-in profile is active stores a copy of its explicit values, then applies the edit. Verify: unit tests for `Capture current globals`, `Edit one profile row`, `First edit copies the built-in profile`.
- [x] 7.2 Sidebar-header Focus toggle button (`aria-pressed`, Enter/Space, visible on-state). Verify: test `Sidebar toggle`.
- [x] 7.3 Settings › Sessions: Focus section — on/off, profile label (Built-in / Custom), Save current, Reset to default, profile rows (`Not set` / `Show` / `Hide`) behind a collapsed `Customize profile` disclosure; match `mockups/focus-and-blocks.html` tab 4. Verify: component tests.
- [x] 7.4 `Focus is on · Turn off Focus` notice on global card blocks, folder Session cards and Effects settings (mockup tabs 2, 3, 5). Verify: component test per `Focus notice on settings pages`.

## 8. Focus verification (Phase B)

- [x] 8.1 Integration test: Focus on with built-in profile → minimal sidebar, safety chips still shown; Focus off → all prior overrides intact (`Off restores the normal setup`). Verify: test passes.
- [x] 8.2 Two-browser sync + restart persistence for Focus state. Verify: server/gateway test.

## 9. Accordion helpers + config (Phase C)

- [x] 9.1 `packages/client/src/lib/folder-focus.ts`: `demandsAttention`, `resolveActiveCwd` (worktree → main path, latest intent wins), `resolveGroupRenderMode`. Verify: tests for every `folder-focus` / `Attention predicate` scenario.
- [x] 9.2 `packages/shared/src/config.ts`: `folderListMode` (unknown → `classic`), `folderAttentionPeek` (default true); Settings → Sessions select + nested toggle. Verify: config parse tests; settings component test.
- [x] 9.3 `expandedFolders` client state from snapshot + `set_folder_expanded`; pinning open clears collapsed. Verify: tests for `Pinned-open folders` scenarios.

## 10. Accordion rendering (Phase C)

- [x] 10.1 `SessionList.tsx`: classic path untouched (DOM-equality test vs pre-change); accordion: header-body focus vs chevron (stopPropagation, keyboard; chevron icon follows rendered mode; pin/unpin on unfocused), render modes with `hasAttention` gated by `folderAttentionPeek`, condensed header for compact modes, attention filter on top of hidden/search, compact-empty row, search/workspace filter forces full. Verify: component tests for every `collapsible-groups` accordion scenario and `session-filtering` scenarios.

## 11. Close-out

- [x] 11.1 Reconcile `mockups/accordion-setting.html` (carried over from the removed `focus-driven-folder-compaction`) with the final Settings → Sessions UI from 9.2. Verify: mockup matches shipped controls or is updated.
- [x] 11.2 `openspec validate add-focus-mode-and-card-block-toggles --strict` passes.
- [ ] 11.3 Full test run + `npm run build`; grep `/tmp/pi-test.log` for failures. Verify: zero new failures.
- [x] 11.4 Update AGENTS.md rows for touched files (`card-sections.ts`, `preferences-store.ts`, `browser-gateway.ts`, `slot-consumers.tsx`, `SessionCard.tsx`, `SessionList.tsx`, `card-section-meta.ts`, `CardSectionsPage.tsx`, `CardSectionsSection.tsx`, `folder-focus.ts`, `config.ts`); CHANGELOG `## [Unreleased]` entry.
- [ ] 11.5 Manual QA (desktop + mobile viewport): hide Automations pill only; turn off animated gradients only; Focus on/off round-trip; accordion with 4+ folders.

## 12. Scenario tests (folded from test-plan.md)

- [x] 12.1 L1 resolver decision table in `packages/shared/src/__tests__/card-sections.test.ts` (exemplar: same file): focus × folder × global × parent combos for `openspec-badge` · `resolveCardSectionVisible` · highest set layer wins, else `true` (test-plan #E1)
- [x] 12.2 L1 legacy parent fallback in `packages/shared/src/__tests__/card-sections.test.ts` (exemplar: same file): global `openspec=false`, `status=false`, children unset · resolve `openspec-badge`, `badge-goal` · both `false`; child `true` overrides parent (test-plan #E2)
- [x] 12.3 L1 per-plugin id derivation in `packages/shared/src/__tests__/card-sections.test.ts` (exemplar: same file): ids `automation`, `mcp-client`, 58/59-char, `Bad_Id` · `pluginSectionId` · valid → `badge-<id>`, 65-char and `Bad_Id` → `null` (test-plan #E3)
- [x] 12.4 L1 `fx-*` ignores folder override in `packages/shared/src/__tests__/card-sections.test.ts` (exemplar: same file): folder `/a` `fx-status-animation=false`, global unset · resolve for `/a` · `true` (test-plan #E4)
- [x] 12.5 L1 built-in focus profile in `packages/shared/src/__tests__/card-sections.test.ts` (exemplar: same file): focus on, no stored profile · resolve `git`, `process`, `pill-automation`, `badge-goal`, `fx-selected-glow`, folder list mode · `false`, normal, `false`, `false`, `false`, `accordion` (test-plan #E5)
- [x] 12.6 L1 save-current snapshot in `packages/client/src/lib/state/__tests__/` new `CardSectionsContext.focus.test.ts` (exemplar: `packages/client/src/components/__tests__/CardSectionsSection.test.tsx`): globals `git=false`, `flows=true`, `openspec=false`, config `classic` · save current · profile `git=false`, `flows=true`, `openspec-badge=false`, `folderListMode=classic`; later global change leaves profile unchanged (test-plan #E6)
- [x] 12.7 L1 focus profile validation in `packages/server/src/__tests__/card-sections-handler.test.ts` (exemplar: same file): 255/256/257 keys, id `../x`, value `"yes"`, mode `"grid"` · `set_focus_profile` · 255/256 accepted + broadcast; others unchanged, no broadcast (test-plan #E7)
- [x] 12.8 L1 folder-scoped `fx-*` write rejected in `packages/server/src/__tests__/card-sections-handler.test.ts` (exemplar: same file): `{path:"/a", section:"fx-status-animation"}` · handler · unchanged, no broadcast; global write accepted (test-plan #E8)
- [x] 12.9 L1 render-mode table in new `packages/client/src/lib/__tests__/folder-focus.test.ts` (exemplar: `packages/shared/src/__tests__/card-sections.test.ts`): all 16 focused × collapsed × pinned × attention combos + peek off · `resolveGroupRenderMode` · matches spec table; peek off + attention → `compactEmpty` (test-plan #E9)
- [x] 12.10 L1 attention predicate in `packages/client/src/lib/__tests__/folder-focus.test.ts` (exemplar: same new file): ask_user / streaming / active / unread / idle+read / ended+read · `demandsAttention` · true,true,true,true,false,false (test-plan #E10)
- [x] 12.11 L1 active-folder derivation in `packages/client/src/lib/__tests__/folder-focus.test.ts` (exemplar: same new file): select worktree session (main `/repo`), activate `/bar`, select `/repo` session again · `resolveActiveCwd` after each step · `/repo` → `/bar` → `/repo`; `/bar` gone → `null` (test-plan #E11)
- [x] 12.12 L1 pin/collapse exclusion in `packages/server/src/__tests__/preferences-store.test.ts` (exemplar: same file, collapsedFolders cases): `/foo` collapsed · pin then collapse · mutually exclusive after each step; disk round-trip keeps both lists (test-plan #E12)
- [x] 12.13 L1 folder list mode parse in the existing shared config test (exemplar: `questionFirst` parse case in `packages/shared/src/__tests__/`): `classic`/`accordion`/`grid`/absent · parse · `classic`/`accordion`/`classic`/`classic`; peek default `true` (test-plan #E13)
- [x] 12.14 L1 OpenSpec phase shown once in `packages/client/src/components/__tests__/SessionCard.card-sections.test.tsx` (exemplar: same file): phase + tags `[]`/`["x"]`, badge on/off, desktop + mobile · render · phase exactly once with badge on, zero with off; tags strip never contains phase (test-plan #E14)
- [x] 12.15 L1 per-plugin badge hide in `packages/client/src/components/__tests__/SessionCard.card-sections.test.tsx` (exemplar: same file): automation + goal badge claims, `badge-automation=false` · render · automation absent, goal present; both hidden → no STATUS frame (test-plan #E15)
- [x] 12.16 L1 slot consumer filter in `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx` (exemplar: same file): legacy claim `automation` + intent `browser` · `isPluginVisible` hides both / none / absent · neither / both / both (test-plan #E16)
- [x] 12.17 L1 directory-card blocks in new `packages/client/src/components/session/__tests__/SessionList.card-blocks.test.tsx` (exemplar: `SessionList.folder-menu.test.tsx`): each `folder-*` / `pill-*` off in turn, then all · render · only toggled block gone; group-by chip stays; all off → header + cards, no empty grid/dividers (test-plan #E17)
- [x] 12.18 L1 folder banner chip in `packages/client/src/components/session/__tests__/SessionList.card-blocks.test.tsx` (exemplar: `tests/e2e/folder-action-banner.spec.ts` states): `folder-banner=false`, re-trust needed then healthy · render + click chip · chip → full banner; healthy → neither (test-plan #E18)
- [x] 12.19 L1 settings rows in `packages/client/src/components/__tests__/CardSectionsPage.test.tsx` and `CardSectionsSection.test.tsx` (exemplar: same files): claims automation (badge+pill), goal (badge+actionbar+pill), no memory · render · directory group + plugin pill rows, no MEMORY, Effects only in global, `openspec-badge` shows `Default (Hide)` (test-plan #E19)
- [x] 12.20 L1 CSS gate parse test in new `packages/client/src/__tests__/fx-gate-css.test.ts` (exemplar: `packages/client/src/components/__tests__/selected-card-fx.test.tsx`): `index.css` · parse rules under `[data-fx-status="off"]` / `[data-fx-glow="off"]` · stripes `animation: none`, no repeating gradient; ring/glow `display: none` (test-plan #E20)
- [x] 12.21 L1 reduced-motion rules untouched in `packages/client/src/__tests__/fx-gate-css.test.ts` (exemplar: same new file): `index.css` · compare `prefers-reduced-motion` blocks to pre-change snapshot · identical; off-rules scoped under `[data-fx-*="off"]` only (test-plan #E21)
- [x] 12.22 L1 classic mode unchanged: run existing `SessionList.*` + collapse suites with `folderListMode` absent (exemplar: `SessionList.expanded-pinned-drag.test.tsx`) · all pass unmodified (test-plan #F8)
- [x] 12.23 L1 corrupt focus state on load in `packages/server/src/__tests__/preferences-store-card-sections.test.ts` (exemplar: same file): `focus={enabled:"x", profile:{sections:{"__proto__":true,"git":"no"}}}` · load · focus off, empty profile, no prototype key, other prefs intact (test-plan #X1)
- [x] 12.24 L1 focus + expandedFolders survive restart in `packages/server/src/__tests__/preferences-store-card-sections.test.ts` (exemplar: same file): focus on + profile + `expandedFolders:["/a"]` · recreate store · identical snapshot (test-plan #X2)
- [x] 12.25 L1 writes disabled during socket gap in `packages/client/src/components/__tests__/CardSectionsSection.test.tsx` (exemplar: same file, `canWrite` cases): `connected=false` · toggle Focus / effect · controls disabled, nothing sent (test-plan #X3)
- [x] 12.25a L1 first edit copies built-in profile in `packages/client/src/lib/state/__tests__/CardSectionsContext.focus.test.ts` (exemplar: `packages/client/src/components/__tests__/CardSectionsSection.test.tsx`): no stored profile · set `badge-goal` Show · stored = built-in explicit values + `badge-goal=true`, mode accordion, label Custom (test-plan #E22)
- [x] 12.25b L1 Focus notice on settings pages in `packages/client/src/components/__tests__/CardSectionsSection.test.tsx` + `CardSectionsPage.test.tsx` (exemplar: same files): Focus on/off × 3 pages · render + click `Turn off Focus` · notice only when on; click turns Focus off (test-plan #E23)
- [x] 12.26 L3 hide automations pill in new `tests/e2e/card-block-toggles.spec.ts` (exemplar: `tests/e2e/kb-folder-slot.spec.ts`): folder with automation pill · global switch `pill-automation` off · pill gone, others present, still gone after reload (test-plan #F1)
- [x] 12.27 L3 Focus round-trip in new `tests/e2e/focus-mode.spec.ts` (exemplar: `tests/e2e/folder-collapse-persistence.spec.ts`): `/a` `git=visible`, global `flows=visible` · Focus on then off · on: `aria-pressed=true`, no GIT/FLOWS, minimal directory card; off: restored, prefs unchanged (test-plan #F2)
- [x] 12.28 L3 Focus sync across browsers in `tests/e2e/focus-mode.spec.ts` (exemplar: `tests/e2e/folder-collapse-persistence.spec.ts` multi-context): two contexts · A toggles on · B converges without reload (test-plan #F3)
- [x] 12.29 L3 status effects off in new `tests/e2e/card-visual-effects.spec.ts` (exemplar: `tests/e2e/idle-fx-pause.spec.ts`): streaming card + board row · `fx-status-animation` off · overlay `getAnimations().length===0`, no repeating gradient, class still `card-stripes-running` on card and board row (test-plan #F4)
- [x] 12.30 L3 glow off in `tests/e2e/card-visual-effects.spec.ts` (exemplar: `tests/e2e/idle-fx-pause.spec.ts`): selected card · `fx-selected-glow` off · `.card-ring-fx` `display:none`, selected border kept, other cards' stripes still animate (test-plan #F5)
- [x] 12.31 L3 accordion clicks in new `tests/e2e/folder-accordion.spec.ts` (exemplar: `tests/e2e/folder-collapse-seek.spec.ts`): `/a` focused, `/b` 1 streaming + 3 idle · chevron `/b` twice, header body `/a` · 4 cards → 1 card; `/a` chevron unchanged (test-plan #F6)
- [x] 12.32 L3 attention clears in `tests/e2e/folder-accordion.spec.ts` (exemplar: `tests/e2e/folder-collapse-seek.spec.ts`): unfocused `/b` streaming read session · turn ends · card leaves, `N sessions — click to view` shown, click focuses `/b` (test-plan #F7)
- [ ] 12.33 Manual: effects-off look and feel, dark + light themes, running / unread / ask_user / selected cards (test-plan: manual-only, #F9)
- [ ] 12.34 Manual: Focus mode minimal UX with 4+ folders on desktop and mobile viewport (test-plan: manual-only, #F10)
