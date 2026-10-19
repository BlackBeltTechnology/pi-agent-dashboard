# Test Plan: colorize-actions-menus

Stage: design   Generated: 2026-10-19

The HARD gate is resolved: every Triple slot is concrete. The doubt-review (3 cycles) resolved every earlier gap:
- the token choice: `--accent-<hue>-text`;
- NEXT precedence;
- the danger-overlay label;
- the lifecycle glyphs;
- invalid-tone handling;
- the kb tone per kind;
- Remove from workspace staying neutral.

Notation: "valid tone" means one of `go|create|caution|danger`. `DAT` = `data-action-tone`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | `isUiTone` guard (plugin-ui-primitive-registry) | EP | L1 | automated | `"go"`, `"create"`, `"caution"`, `"danger"`, `"purple"`, `""`, `"Danger"`, `"constructor"`, `"__proto__"`, `"toString"`, `42`, `null`, `undefined`, `{}` | call `isUiTone(v)` | true for exactly the 4 tones; false for every other value |
| E2 | Total prototype-safe helpers (design D2) | EP + decision table (tone × disabled) | L1 | automated | each valid tone × `{disabled:false,true}`, plus each invalid value from E1 | `toneIconClass`, `toneRowClass`, `toneAttr` | enabled valid tone → the exact literal for its hue (`text-[var(--accent-<hue>-text)]`); `toneRowClass` non-empty only for enabled `danger` (hover+focus bg `--tint-red-bg`, text `--accent-red-text`); disabled → `""` from both class helpers but `toneAttr` = tone; any invalid value → `""` / `undefined`; return type always `string` / `UiTone \| undefined` |
| E3 | Literal-only maps (design D2) | static | L1 | automated | `client-utils/src/tone.ts` source | read the file | every class appears as a complete literal; no template interpolation of a tone value |
| E4 | ActionList menu mode honours tone | EP | L1 | automated | `ActionList` inside `ActionListMenuContext`, `actions:[{label:"Delete",icon:"mdiDelete",tone:"danger"}]` | render | `menuitem` has `DAT="danger"`; the icon carries `text-[var(--accent-red-text)]`; the row carries the danger hover/focus classes and not `hover:bg-[var(--bg-tertiary)]` |
| E5 | ActionList inline mode honours tone | EP | L1 | automated | no menu context, `actions:[{label:"Run",icon:"mdiPlay",tone:"go"}]` | render | the button has `DAT="go"`; the icon has `text-[var(--accent-green-text)]`; the label has no tone class |
| E6 | ActionList invalid tone renders neutral and stays activatable | EP | L1 | automated | actions with `tone:"purple"`, `"__proto__"`, `42`, each with an `onClick` spy | render, then click | no `DAT`; icon has no tone class; spy called once per click; no throw |
| E7 | ActionList untoned output is unchanged | regression | L1 | automated | `actions:[{label:"Open",icon:"mdiOpenInNew"}]`, menu and inline | render, then compare to a snapshot taken before the change | no `DAT`; no element gains a `class=""` attribute; snapshot equal |
| E8 | Session host tones (derivation) | decision table | L1 | automated | `deriveSessionMenu` for: ended session with `sessionFile` (Resume, Fork); alive git session (New session, New worktree, Exit); worktree with no PR (Open PR) and with PR #12 + URL (View PR #12); dirty tree (Commit); attached change with Verify, New change, Propose, Archive anyway available | derive | Resume/New session/Verify/Merge = go; Fork/New change/Propose/Open PR = create; New worktree/Commit/Archive anyway = caution; Exit/Close worktree = danger; Rename, Archive session, Push, Switch branch, View PR, Detach, Open change have no `tone` |
| E9 | NEXT strips tone, enabled and disabled | state | L1 | automated | (a) Merge-emphasis worktree session; (b) streaming session whose NEXT is Verify | derive | the NEXT item has `tone === undefined` in both; (a) `emphasis` true; (b) `disabled` true, `emphasis` false; in (a) the OpenSpec primary's home-group copy keeps its tone |
| E10 | MenuEntry renders tone, NEXT and inert correctly | decision table (tone × enabled × emphasis) | L1 | automated | `SessionActionsPanel` with groups containing: danger enabled; danger disabled; go enabled; neutral enabled; NEXT enabled (Apply); NEXT disabled | render | danger enabled: `DAT="danger"`, red icon class, danger row classes; danger disabled: `DAT="danger"`, no icon tone class, no hover class at all; go: green icon class; neutral: no `DAT`, neutral interaction classes; NEXT enabled: `data-emphasis="primary"`, `--tint-blue-border` border, `--accent-blue-text` icon, `--text-primary` semibold label, no `DAT`, no tinted bg class, has `focus:bg`; NEXT disabled: no border accent, no `DAT` |
| E11 | Keyboard focus background kept on non-danger rows | regression | L1 | automated | panel with a neutral item, an inert item, enabled NEXT, and a group with ≥ 2 rare items (renders More…) | render | each of the neutral, inert, NEXT and More… rows has `focus:bg-[var(--bg-hover)]`; `ITEM_BASE` no longer contains `focus:bg` |
| E12 | Lifecycle row glyph + colour per state | EP over states | L1 | automated | lifecycle segments P done, D done, S skipped, T current, A todo | render `LifecycleRow` | glyphs `✓ ✓ – ▸ ○`; colour classes green-text ×3, yellow-text, `--text-tertiary`; `data-state` = `done done skipped current todo`; accessible names `Proposal, done` … `Archive, todo`; skipped and todo stay non-focusable when inert |
| E13 | Folder host tones | decision table | L1 | automated | `FolderActionsMenu` items built by `SessionList` for a folder: in a workspace, with an opted-out OpenSpec (Enable OpenSpec), 2 broken sessions, init status `setupOutdated:true` then `false` | render | Enable OpenSpec `DAT="create"`; Clean up broken (2) `DAT="caution"`; Project setup `DAT="caution"` only while `setupOutdated`; Remove from workspace, Pin, Manage worktrees, Directory Settings, Refresh have no `DAT`; the add-to-workspace node item has no `DAT` |
| E14 | `isProjectSetupOutdated` drives both label and tone | EP | L1 | automated | status `{setupOutdated:true}`, `{setupOutdated:false}`, `undefined` | call `isProjectSetupOutdated` and `projectSetupLabel` | true/false/false; the label has the `● update` suffix exactly when the predicate is true |
| E15 | Radio items never toned | EP | L1 | automated | folder menu with the Group-by radio group | render | no `menuitemradio` carries `DAT` |
| E16 | Folder disabled toned item | EP | L1 | automated | contributed `{ tone:"caution", disabled:true }` | render | `DAT="caution"`, no icon tone class, no hover class |
| E17 | Badge uses text-role token | regression | L1 | automated | folder item with a `badge` | render, then scan the rendered markup | badge class contains `text-[var(--accent-orange-text)]`; no host-rendered element carries a `text-amber-` (raw palette) class |
| E18 | Runtime forwards a valid tone | EP | L1 | automated | `FolderMenuStore.register(pluginId,{id,group,label,icon,onSelect,tone:"danger"})` | read the registered entry | entry `.tone === "danger"` |
| E19 | Runtime neutralises an invalid tone, keeps the item | EP | L1 | automated | register with `tone:"purple"`, `tone:"__proto__"`, `tone:{}` | read the entries | each entry exists with `.tone === undefined`; sibling items unaffected |
| E20 | Runtime whitelist still blocks markup | regression | L1 | automated | register with `tone:"go"` plus `node:<div/>` and `className:"x"` | read the entry | `.tone === "go"`; no `node` or `className` key on the entry |
| E21 | Hook forwards a live tone change | state-transition | L1 | automated | `useFolderMenuItem` rendered with `tone:"caution"`, then re-rendered with `tone:undefined` | rerender | the store entry's tone changes `caution → undefined` without unmounting |
| E22 | KB tone follows action kind | EP over 7 kinds | L1 | automated | `FolderKbSection` folder-menu contribution for kinds `pin, missing, configure, retry, busy, index, reindex` | render each | `DAT="caution"` (via the store entry `.tone`) only for `retry`, `index`, `reindex`; none for the other 4; switching `reindex → pin` updates the tone (memo dependency) |
| E23 | Team, goal and automation tones | EP | L1 | automated | team section for a manageable folder (Team, Team settings, Disable team) and an enableable folder (Enable team for this folder); goal New goal; automation New automation | render, then read the store | Disable team = danger; Enable team = create; New goal = create; New automation = create; Team and Team settings have no tone |
| E24 | Plugin packages typecheck with tone literals | static | ci | automated | goal, automation, team and kb packages after adding `tone: "…" as const` | `npx tsc --noEmit -p packages/<plugin>` | exit 0 for all 4 |
| E25 | Contrast floors across every palette (design D10) | EP over 18 palette/mode pairs | L1 | automated | base dark/light from `index.css` + each `themes.ts` palette × mode | compute WCAG ratios | `--accent-{green,blue,orange,red}-text` ≥ 3:1 on `--bg-secondary`; `--accent-red-text` ≥ 3:1 and ≥ 4.5:1 on `--tint-red-bg`; `--accent-orange-text` ≥ 4.5:1 on `--bg-secondary`; `--accent-green-text`, `--accent-yellow-text`, `--text-tertiary` ≥ 3:1 on `--bg-secondary`; a synthetic fixture (`#8a8a8a` on `#e1e2e7`) fails, proving the assertion bites |
| E26 | Theme token guard has no new findings | static | ci | automated | repo after the change | `node scripts/theme-token-guard.mjs` | exit 0; no new `accentText` or `undeclared` occurrences |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Danger hover pins the label (session) | state (rest → hover) | L3 | automated | alive session `s1`, menu open | hover **Exit pi session** | `DAT="danger"`; icon computed colour = resolved `--accent-red-text`; at rest, label colour = a neutral item's label colour; on hover, background = resolved `--tint-red-bg` and label = resolved `--accent-red-text` |
| F2 | Danger keyboard focus (session) | state (focus) | L3 | automated | worktree session menu open | ArrowDown to **Close worktree…** | background = `--tint-red-bg`; label = `--accent-red-text` |
| F3 | Neutral item unchanged | invariant | L3 | automated | menu open | read computed styles of **Rename…** | no `DAT`; icon colour equals label colour |
| F4 | Disabled toned item looks inert | state | L3 | automated | session with `cwdMissing:true`, menu open | hover **New session** | `aria-disabled="true"`, `DAT="go"`; icon colour ≠ `--accent-green-text`; background does not change on hover |
| F5 | NEXT outlined, not filled; Merge in NEXT | decision table | L3 | automated | (a) idle session on an `IMPLEMENTING` change; (b) worktree with an open passing PR (Merge NEXT) | open the menu | NEXT background = menu surface (`--bg-secondary`); border = resolved `--tint-blue-border`; icon = `--accent-blue-text`; no `DAT`; in (b) the label is Merge |
| F6 | Disabled NEXT | state | L3 | automated | streaming session whose NEXT is Verify | open the menu | NEXT `aria-disabled="true"`, no `DAT`, no blue border |
| F7 | Lifecycle bars match state and contrast | invariant | L3 | automated | change with P, D done, S current, T, A todo | open the menu and read the bar computed colours | P, D bar = `--accent-green-text`, S = `--accent-yellow-text`, T, A = `--text-tertiary`; glyphs `✓ ✓ ▸ ○ ○` visible; each bar ≥ 3:1 vs `--bg-secondary` computed |
| F8 | Plugin action-list tone in PLUGINS group | EP | L3 | automated | harness plugin publishes `action-list` on `session-card-action-bar` for `s1` with `{label:"Stop recording", tone:"danger"}` | open `s1`'s menu | the PLUGINS `menuitem` has `DAT="danger"` and an `--accent-red-text` icon; activating it closes the menu |
| F9 | Folder plugin tone end-to-end | EP | L3 | automated | team-managed folder in the harness | open the folder actions menu | **Disable team** has `DAT="danger"` and a red icon; hover gives `--tint-red-bg` with a red label; **Remove from workspace** has no `DAT` |
| F10 | Tones render in the sheet form | BVA on viewport (mobile predicate) | L3 | automated | viewport 390×844, then 1200×560 (short but wide) | open the folder actions menu (sheet) | **Clean up broken (N)** has `DAT="caution"` and an `--accent-orange-text` icon in both viewports |
| F11 | Contrast holds in the browser on low-margin palettes | EP (palette) | L3 | automated | base dark, base light, tokyo-night light, catppuccin light | switch palette, open both menus, read computed colours | toned icon colours ≥ 3:1 vs computed `--bg-secondary`; danger hover label ≥ 4.5:1 vs computed `--tint-red-bg`; badge ≥ 4.5:1 |
| F12 | Visual balance (colour overload) | visual/subjective | — | manual-only | both menus, dark and light, two palettes | a human compares against the mockup `mockups/actions-menus-tones/` | [judgment: about 4 toned items per menu read as guidance, not noise; NEXT is still the clear primary] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Hostile tone from an untyped intent never reaches the DOM unvalidated | fault-injection (malicious input) | L1 | automated | `IntentRenderer` renders an `action-list` intent whose action has `tone:"danger\" onmouseover=\"x"` and another with `tone:"go text-[red]"` | render | no `DAT` attribute; no class containing the injected text; the item renders neutral and is activatable |
| X2 | Old host / new plugin compatibility | fault-injection (version skew) | L1 | automated | a contribution object carrying `tone` passed to the *pre-change* whitelist shape (simulated by the store with tone forwarding stubbed off) | register, then render | the item renders neutral and works (degrades, no throw) |

---

## Coverage summary

- Requirements covered: 8/8:
  - session tone rendering + host tones;
  - NEXT + lifecycle;
  - PLUGINS tone;
  - folder tone rendering + host / plugin tones + badge;
  - folder contribution `tone` forwarding;
  - `ui:action-list` tone, menu + inline + invalid;
  - contrast floors;
  - align-ui merge rule (via E10, E11).
- Scenarios by class: edge 26 · perf 0 · frontend 12 · error 2.
- Scenarios by level: L1 26 · L3 11 · ci 2 · manual-only 1.
- Scenarios by disposition: automated 39 · manual-only 1.

## New infra needed

- none.
- L1 extends:
  - `client-utils/src/__tests__/ActionList.test.tsx`;
  - `client/src/lib/session/__tests__/session-menu-items.test.ts`;
  - `client/src/components/__tests__/FolderActionsMenu*.test.tsx`;
  - `dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx`;
  - `kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`;
  - `goal-plugin/src/__tests__/FolderGoalsSection.test.tsx` and `automation-plugin/src/__tests__/FolderAutomationSection.test.tsx`.
- L1 adds:
  - `client-utils/src/__tests__/tone.test.ts`;
  - a `SessionActionsPanel` test;
  - a team-plugin section test;
  - a contrast test next to `client/src/lib/__tests__/theme-body-text-contrast.test.ts`.
- L3 extends `tests/e2e/session-actions-menu.spec.ts` and `tests/e2e/folder-actions-menu.spec.ts`. Palette switching follows `tests/e2e/openspec-board-drop-contrast.spec.ts`.
