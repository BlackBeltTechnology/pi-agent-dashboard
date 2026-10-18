# Audit — OpenSpec Workflow Schema UI (`add-pi-spec-driven-schema`)

Shipped from spec prose with no mockup: Settings ▸ OpenSpec ▸ Workflow Schema (`components/openspec/OpenSpecWorkflowSchemaSection.tsx`) and the folder-section `WorkflowSchemaChip` (`FolderOpenSpecSection.tsx`).
Source: worktree `os/add-pi-spec-driven-schema` @ `ccca3a548`. Plan: `ui-plan.md` (A1–A12, D1–D10).
Board: `workflow-schema.html` (30 states, 5 surfaces). As-built replica `asbuilt.css` (Tailwind classes 1:1, oklch palette, incl. the defects; Dialog + ToggleField copied from `client-utils` / `dashboard-plugin-runtime`). Proposed recipes `schema.css`. Tokens `tokens.css` (copied from `add-vault-reach-all-projects`; `index.css` / `themes.ts` unchanged since).
Action sets on the as-built column come from a literal port of `allowedWorkflowSchemaActions`; the proposed menu is derived from the same function minus the recommended action and minus Remove while `configured === pi-spec-driven` (D3). That derivation reproduces the D2 table row for row (see "Deviations").

## As-built findings

Measured with `tests/e2e/helpers/computed-contrast.ts` on `.col.asbuilt .frame` (1440 frame) unless noted.

| # | Verdict | Measured evidence |
|---|---|---|
| A1 | **Confirmed** | Raw `cyan-400` action buttons are 1.51:1 on the light surface (65 buttons); `green-400` result 1.56:1; `yellow-400` chip 1.34:1 and warning line 1.38:1 and the adopt warning 1.57:1; `red-400` result 2.53:1 light / 3.48:1 nord. Dark is clean for the cyan buttons. |
| A2 | **Confirmed, number corrected** | Buttons and status line are `text-[10px]`: 65 button + 28 status-line size failures per theme. Button box is 25 px high (not ~22): 10 px × `line-height: 1.5` + `py-1` + border. Proposed: 32 px from `sm`, 44 px at the 375 frame. |
| A3 | **Confirmed** | Every row reads `schema: <configured> · generated: <enum>` (+ ` · missing`, ` · N unpinned`) at 10 px, 28 renderings. |
| A4 | **Confirmed in kind, refuted in count** | The loop never renders six buttons: the maximum is **4** (enabled + 3 unpinned: Disable, Update, Pin…, Remove). Most rows render 1–3. Destructive Remove always carries the same style as Update. |
| A5 | **Confirmed** | Remove is offered while `configured === pi-spec-driven` for `current`, `outdated`, `newer`, `conflict` on the board (and `incompatible` by `REMOVE_FROM`); the server `doRemove` refuses with “the config default is still pi-spec-driven; disable first”. |
| A6 | **Confirmed** | `card-busy`: both rows’ buttons are `disabled`; the busy row shows no progress, no text change. |
| A7 | **Confirmed** | Result is `Done.` / `Nothing to change.` + `(branch)` + a comma-joined path run at 10 px (`result-success-worktree`). No commit reminder. Partial appends `Partially applied — review the written files.` straight after the server error with no separator. Result text contrast: 1.38–2.53:1 light, 3.48:1 nord. |
| A8 | **Confirmed** | Enable dialog lists a backticked sentence as a `<li>` inside the monospace path list (`dialog-enable`). |
| A9 | **Confirmed** | Title is `<Verb> pi-spec-driven?` with no project; no per-action consequence; Remove shows one path and nothing else; update says `7 active change(s)` with no names (`dialog-update`). |
| A10 | **Confirmed** | Chip is `⚠` + raw enum (`schema outdated`), yellow palette, 10 px (7 size + 7 contrast failures light), 21 px high. `newer` and `incompatible` get the same yellow as a real conflict. |
| A11 | **Confirmed** | Selected row differs only by `border-blue-500/60`: 2.40:1 (dark), 2.02:1 (light), 1.80:1 (nord) against its own row — below the 3:1 non-text floor; no focus move (`scrollIntoView` only). |
| A12 | **Confirmed** | `No project reports a workflow schema status yet.` is `text-[11px] text-muted`: 2.78:1 dark, 2.32:1 light, 2.07:1 nord — fails in all three themes. |

### New as-built problems found while building the board

| # | Finding | Evidence |
|---|---|---|
| A13 | Shared `Dialog.Action` primary is `text-white` on `--accent-primary`: **3.68:1** in all three themes (4 primary dialogs on the board, 12 px text). `client-utils`, so it hits every dialog in the app; the contract’s primary button is `--accent-solid` (5.17:1). Out of scope of this change unless approved; proposed dialogs use `--accent-solid`. | `dialog-enable`, `dialog-update`, `dialog-pin`, `dialog-disable-stampless` |
| A14 | `toResult` ignores `data.skipped` (changes the server could not pin: symlinked dir, already stamped, lost a race). A partial pin run reports `Done.` with no mention. | `workflow-schema.ts` `createPins` → `skipped`; `toResult` reads only `written` / `warnings`. Rendered after approval: `result-pin-skipped`. |
| A15 | Moving Update / Disable / Pin / Remove into a menu (D1) means every unit/e2e test that clicks `workflow-schema-<action>-<cwd>` must open the card menu first. The testids stay (on the menu items) and the recommended action keeps its testid on the card. | Not a defect of the as-built UI; recorded for the test plan. |

## Measurements

Probe: `node_modules/.cache/retro-ux/schema-probe.mts` (bun + Playwright; `measureText` → `contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator`) over every `article.state` (28) on `.col.<asbuilt|proposed> .frame`. Counts are renderings, not unique elements (a project that appears in several states counts in each).

| Theme | As-built contrast / size / focus | Proposed contrast / size / focus |
|---|---|---|
| Base dark | 5 / 108 / 0 | 0 / 0 / 0 |
| Base light | 85 / 108 / 0 | 0 / 0 / 0 |
| Nord dark | 8 / 108 / 0 | 0 / 0 / 0 |

(Re-probed after the approval edits: `result-pin-skipped` added, D2 overlap flipped. Breakdown below is from the 27-state run.)

Proposed re-probed at the 768 and 375 frames: 0 / 0 / 0 in all three themes, no horizontal overflow at 375. Tap targets measured: 32 px (recommended action, menu button, chip) at 1440; 44 px at the 375 frame. Console errors: 0.

As-built breakdown (counts per theme):

| Group | Contrast (dark / light / nord) | Size (all themes) | Worst |
|---|---|---|---|
| Row action buttons | 0 / 65 / 0 | 65 | 1.51:1 cyan-400 (light), 10 px |
| Status line | 0 / 0 / 0 | 28 | 10 px |
| Result line | 0 / 6 / 3 | 2 | 1.38:1 yellow warning (light), 3.48:1 red (nord) |
| Folder chip | 0 / 7 / 0 | 7 | 1.34:1 (light), 10 px |
| Empty text | 1 / 1 / 1 | 0 | 2.07:1 (nord) |
| Dialog confirm (primary) | 4 / 0 / 4 | 0 | 3.68:1 white on `--accent-primary` |
| Dialog body (adopt warning) | 0 / 1 / 0 | 0 | 1.57:1 yellow-400 (light) |

Focus: the as-built row and chip buttons carry `focus-ring`; the shared `Dialog.Cancel` / `Dialog.Action` do not but fall back to the UA outline, so the probe reports 0 (not counted as a finding).

## Decisions on the board

| Decision | Findings | Board states |
|---|---|---|
| D1 Project card: pill + sentence + one recommended action + More actions menu | A3, A4 | section-overview, card-not-enabled, card-disabled-kept, card-enabled, card-unpinned, card-outdated, card-newer, card-incompatible, card-conflict, card-unmanaged, card-missing, card-menu-open |
| D2 State → copy → recommended action | A3 | every `card-*`; section-overview (six states at once) |
| D3 Remove hidden while the config names the schema | A5 | card-enabled, card-unpinned, card-newer, card-conflict, card-outdated (enabled card), card-menu-open (Remove shown where allowed), dialog-remove |
| D4 Per-row busy | A6 | card-busy |
| D5 Result callout | A7, A14 | result-success-worktree, result-pin-skipped, result-noop, result-partial, result-refused, result-409 |
| D6 Dialog per action | A8, A9 | dialog-enable, dialog-update, dialog-adopt, dialog-pin, dialog-disable-stampless, dialog-remove |
| D7 Folder chip as severity pill | A10 | chip-variants |
| D8 Deep link: focus ring + caption + focus to heading | A11 | section-deep-link |
| D9 Empty state | A12 | section-empty |
| D10 Section intro | — | section-overview, section-empty, section-deep-link |

### Deviations from `ui-plan.md` (resolved in the approval below)

1. **D2 row overlap.** `other / outdated` matches both “Disabled, files kept” and “Update available”. The board gives the warning precedence (pill *Update available*, **Update schema…** recommended, **Enable…** in the menu); “Disabled, files kept” applies to `other / current`. Both shown in `card-outdated` (compsychletter, pi-flows).
2. **D2 `incompatible` while enabled.** The table lists only Remove (when not configured), so an enabled project would have no action at all. The board keeps **Disable…** in the menu whenever the config names the schema (redesign mode `preserve`: the action set does not shrink).
3. **D5 “36 files”.** The server’s `written` holds paths (the schema dir is one entry), so the callout says “N paths written” (4 in `result-success-worktree`), not “files”.
4. **A4 “six buttons”** is refuted (max 4). `card-menu-open` shows the as-built’s three buttons for judo-ng.
5. **D7 `newer`.** D2 makes it an *info* pill; D7 says warning or error. The board renders the chip as info with the info icon.
6. **D6 Enable path list.** The client cannot enumerate the changes it will pin (`unpinnedChanges` is only filled while enabled), so the list shows `openspec/changes/*/.openspec.yaml` and a help line explains the `*`. The pinned-to value is the project’s current default (`spec-driven` or `team-flow`), per `createPins(c, toPin, prev)`.
7. **D1 unpinned names.** “These changes follow the new default…” is followed by the change names (up to 5, “and K more”); the plan did not say where the names go.

## Approval

Date: 2026-10-18. Board served at `http://localhost:55827/workflow-schema.html` (LAN `http://192.168.16.203:55827/workflow-schema.html`); one `ask_user` batch, answered explicitly (every option ticked by the user).

| Item | Decision |
|---|---|
| D1–D10 | **All approved**: project card + More actions menu, human state labels/sentences, Remove hidden while enabled (bug fix), per-row busy, result callouts (commit reminder, Show files), per-action dialog design, folder chip redesign, deep-link outline + focus, empty-state copy, section intro copy. |
| A13 shared `Dialog.Action` primary 3.68:1 | **Fix the shared `Dialog.Action` in this change (app-wide)**: primary intent uses `--accent-solid` (contract primary-button recipe). |
| A14 skipped pins | **Show them**: the Pin result names the skipped changes (`result-pin-skipped`). |
| Deviation 1 (D2 overlap, disabled + outdated) | **Disabled first**: pill “Disabled, files kept” (sentence notes “an update is available”), **Enable…** recommended, **Update schema…** and **Remove schema files…** in the menu. Board updated (`card-outdated`, pi-flows). |
| Deviations 2–7 | Accepted as on the board (no objection raised; they follow from the approved decisions and the server contract). |
| A15 | Test consequence only: tests open the card menu before clicking a menu action; testids unchanged. |

### Addendum — doubt-review gap fill (2026-10-18, second `ask_user` batch)

A cross-model doubt review of the spec fold found two states the board had not covered; both answered explicitly:

| Gap | Decision | Board |
|---|---|---|
| Previous-default selector had no source for project schemas (offered `spec-driven` + configured only) | **Add `workflowSchema.projectSchemas`** (server readdir of `openspec/schemas/`, minus `pi-spec-driven`, no symlinks / transient names); selector = `spec-driven` + `projectSchemas` | `dialog-adopt-project-schemas` |
| Config default (not `pi-spec-driven`) that resolves in no schema directory | **“Default schema missing” card**: error pill, sentence naming the schema, no recommended action, allowed actions in the menu | `card-missing-default` |

Re-probe after the addendum (30 states): as-built 5/110/0 · 87/110/0 · 8/110/0 (dark · light · nord); proposed 0/0/0 in all three; console clean.
The precedence of the card states is fixed by the `settings-panel` delta's numbered table (first match wins); the board's `present()` follows that order.
