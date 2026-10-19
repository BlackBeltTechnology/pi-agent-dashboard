## Context

See proposal.md, "Why". The approved board is `mockups/index.html`; its measurements, rubric and decisions are in `mockups/ui-plan.md`.

Current state on `develop` (after #966 `add-pi-spec-driven-schema` and #967 `retro-ux-plugin-settings-wave-2` merged):

- **The runtime kit already has on-token pill and notice.** `packages/dashboard-plugin-runtime/src/settings-fields.tsx`:
  - `SettingsStatusPill` (`:618`): five tones, `--severity-*` classes, default icon per tone via static `@mdi/js` imports, 11 px (12 px inside interactive), raw state in `data-status`.
  - `SettingsNotice` (`:481`): severity classes, `onRetry` / `retrying` / `details` (copied, never rendered) / `actions`.
  - `SettingsCopyButton` copies through `navigator.clipboard`.
  - 31 plugin files use them.
- **Dependency direction.**
  - `packages/client` depends on `dashboard-plugin-runtime` (`packages/client/package.json:30`) and on `client-utils` (`:39`).
  - `client-utils` itself depends on `dashboard-plugin-runtime` (`packages/client-utils/package.json:158`).
- **`ui:status-pill`** (`packages/client-utils/src/StatusPill.tsx:20-36`): raw `rgba()` maps chosen by a `MutationObserver` on `data-theme`, no default icon, states `running | success | info | warn | error | muted`.
- **Core copies.**
  - Services `StatePill`, `ServicesOperateCallout` and `ActionFailure` live in `settings/services/services-ui.tsx:14-125`.
  - Vault `StatusPill`, `GrantStatusPill`, `BindingStatePill`, `Callout` and `ErrorLine` live in `settings/vault/vault-ui.tsx:15-180`, and `OperateRequiredCallout.tsx:56` holds another callout.
  - Other copies: `ProviderHealthPill.tsx:60-104`, `components/packages/plugin-row-parts.tsx:40-101`, `OpenSpecBoardView.tsx:179` (`BoardStatePill`).
- **Dialog.** The main spec `dialog-system` already has the `--accent-solid` primary (archived by #966). `Dialog.tsx:197` paints it; danger is still `bg-red-600` (`:198`), the scrim is `bg-black/60` (`:112`) and the panel is `bg-[var(--bg-primary)] rounded-lg` (`:124`).
- **Guards.**
  - `scripts/theme-token-guard.mjs` scans `packages/client/src` plus every plugin client root (wave 2), but not `client-utils` or `dashboard-plugin-runtime`. Its arms do not see raw palette classes or `rgba()` in `style`.
  - The file-list scan `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts:29-41` does see them. Its paths are rooted at `packages/client/src/components` plus explicit plugin paths.
- **Spec rules that bound the migration.**
  - `operate-required-remedy` keeps the generic "Couldn't load the vault: …" line as a line, not a callout (`openspec/specs/operate-required-remedy/spec.md:265-275`), and requires "Request access" links in remedy rows (`:197`, `:226`).
  - `settings-panel` keeps dirty indicators and plugin health dots (`SettingsPanel.tsx:1490`, `:1546`).
  - `client-build-config` keeps `@mdi/js` key-resolved icons lazy (`openspec/specs/client-build-config/spec.md:108-122`); named imports stay eager.
  - `theme-system` "Readable text on aligned action surfaces" applies to every file on the `message-severity-tokens` list.

## Goals / Non-Goals

**Goals:**
- The runtime kit becomes the one implementation of pill, notice and inline action error. Core and plugins import it; `ui:status-pill` renders it.
- Bring dialog, session actions menu and settings rail to the board's proposed state, with no prop or behaviour change.
- Put every touched recipe file under a rule that fails on a raw colour.

**Non-Goals:**
- New `UI_PRIMITIVE_KEYS`. Plugins already import the kit directly (`settings-panel` "Shared settings field components…").
- Changing `ui:status-pill`'s or `ui:dialog`'s props.
- New theme tokens.
- Restyling the rest of `SettingsPanel.tsx` or `OpenSpecBoardView.tsx`.

## Decisions

### D1. The runtime kit is canonical (user decision, 2026-10-18)

`SettingsStatusPill`, `SettingsNotice` and a new `SettingsActionError` in `dashboard-plugin-runtime` are the single implementation. Wave 2 shipped the first two on tokens with static icons. That answers the cold-load icon finding and keeps the 31 plugin call sites untouched.

- *Alternative: a new `client-utils` home behind `ui:notice` / `ui:action-error` keys.* Rejected. It would rewrite wave 2's shipped kit, contradict `settings-panel`'s direct-import rule, and add public API for no new capability.

### D2. `ui:status-pill` renders `SettingsStatusPill`

`client-utils/src/StatusPill.tsx` keeps its props and `data-status-pill`. It maps `state` to a tone and a word passthrough:

| `state` | Tone | Icon |
|---|---|---|
| `running` | `info` | spinning `mdiLoading`, `motion-reduce:animate-none` |
| `success` | `success` | tone default |
| `info` | `info` | tone default |
| `warn` | `warning` | tone default |
| `error` | `error` | tone default |
| `muted` | `neutral` | tone default |

Then it renders `SettingsStatusPill`. An explicit `icon` key resolves through `useMdiIconByKey` (lazy, as today) and is passed as `icon={resolved ?? undefined}`, so the tone default shows until the key resolves or when it is unknown. `running` passes `icon={mdiLoading}` with the new `spinning` prop (D3). The raw maps and `useIsLightTheme` are deleted. `tooltip` becomes `title` on a wrapper span.

- **Decided in implementation.** `running` always shows the spinning `mdiLoading` and ignores an explicit `icon` key (a progress state needs the progress glyph, and it skips the lazy 2.8 MB set). The kit's neutral tone has no default glyph, so `muted` passes `mdiMinusCircleOutline` itself: test-plan #E1 expects an icon on every state, and changing the kit's neutral default would alter the 31 plugin call sites. `data-status-pill` and `title` sit on a thin wrapper span, because `SettingsStatusPill` only exposes `data-status`.
- **Visual impact.** Base palettes change too: `running` goes from green to info-blue, and `warn` goes from yellow to the orange-derived warning triple. This is intended; one meaning, one colour.

### D3. Kit extensions, all additive

- **`SettingsStatusPill`.** New prop `spinning?: boolean` adds `animate-spin motion-reduce:animate-none` to the icon.
- **`SettingsNotice`.**
  - New prop `remedies?: { icon: string; content: ReactNode }[]`, rendered as rows under `children` in the order given. Callers filter unknown remedies first, as vault does today. `content` may hold links, which the vault "Request access" row needs.
  - `aria-busy` is set while `retrying`.
  - Existing props are unchanged. `details` keeps its shipped behaviour: copied by "Copy details", never rendered.
- **Added during migration** (cycle 3, below): `SettingsNotice` `icon`, `remediesLabel`, `remedyTestId`, `retryTestId`, remedy `id`; explicit `retrying={false}` → `aria-busy="false"`.
- **`SettingsActionError` (new).** Props `{ id, children, details?, testId? }`. Renders `role="alert"`, `mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]`, a static `mdiAlertCircleOutline`, the sentence, and a `SettingsCopyButton` when `details` is set. Exported from the runtime barrel.
- **`SettingsCopyButton`.** When `navigator.clipboard` is missing or rejects, it shows the existing failure label instead of "Copied". Its behaviour is checked and fixed if needed. #969 already made it secure-context-safe.

### D4. Core migrations keep ids and attributes; visible copy changes are listed

| Surface | Becomes | Kept |
|---|---|---|
| Services `StatePill` | `SettingsStatusPill` with MDI icons replacing glyphs | label, `data-testid`, `data-state` |
| `ServicesOperateCallout` | `SettingsNotice` + remedies | |
| `ActionFailure` | `SettingsActionError` | the code moves to `details` |
| Vault pills | `SettingsStatusPill` | |
| Vault `Callout`, `OperateRequiredCallout` | `SettingsNotice` | copy, links, `aria-busy` |
| Vault `ErrorLine`, `FieldError` | `SettingsActionError` | |
| Vault "Couldn't load the vault: …" line | stays a line | |
| `ProviderHealthPill` | `SettingsStatusPill` | `data-testid="health-pill"`, `data-state` |
| `provider-error-line` | `SettingsActionError` (its raw text becomes `details`) | |
| `plugin-row-parts` `StatusPill` | `SettingsStatusPill` with human words | |
| `plugin-row-parts` load-error `<pre>` | `SettingsNotice` with `details` | |
| `BoardStatePill` | `SettingsStatusPill` | |

`TONE_PILL` is deleted once it has no consumers. The board's state-chip mapping in `openspec-board-status-visuals` stays intact: only the pill rendering changes.

**Intended visible-copy changes** (each has a spec scenario):
- the services refused-action code leaves the sentence (`services-settings-ui` "Service detail page", MODIFIED);
- plugin-list raw states become words (`shared-status-recipes`);
- glyphs become MDI icons;
- `ui:status-pill` gains default icons.

### D5. Dialog: `Dialog.tsx` only

| Part | Change |
|---|---|
| Scrim | `bg-[var(--bg-overlay)]` |
| Panel | `rounded-xl border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised elevation |
| Title | `text-lg` |
| Icon tile | info severity triple (`Dialog` cannot see its action intents without a new prop, and props are frozen; the board's red tile for destructive confirms is left to a later prop addition) |
| Close button | `min-h/min-w 44 px`, 36 px from `sm` |
| Actions and Cancel | contract heights, `font-semibold` |
| Danger action | `--tint-red-{bg,fg,border}` |

The primary fill is already shipped. The MODIFIED requirements keep every main scenario name. "Dialog visual baseline" and "Dialog action button intents" change their content on purpose; "Dialog header slot" changes the tile colour. The MODIFIED "Dialog action button intents" copy in this change equals the archived main spec plus the danger and size edits, so there is no remaining overlap. The `message-severity-tokens` "Non-error surfaces are unaffected" scenario still holds for other files; `Dialog.tsx` simply joins the governed list.

### D6. Session actions menu: classes in `SessionActionsPanel.tsx`

- Group heading (`:263`): 10 px becomes 11 px semibold `--text-secondary`.
- `ITEM_BASE` (`:27`): `min-h-[36px] max-sm:min-h-[44px]`.
- `More…` button and count (`:300`, `:303`): `--text-tertiary` becomes `--text-primary`; the count goes from 10 px to 12 px `--text-secondary`.
- Disabled items (`:334`): the `--text-muted` label becomes `--text-secondary` + `aria-disabled`.
- The disabled reason (`:340`) becomes a wrapping block line, 12 px `--text-secondary`, referenced by `aria-describedby`.
- The PLUGINS container (`data-session-menu-plugins`, `:245`) sets `text-[var(--text-primary)]`. Plugin DOM that sets no colour inherits it; the host does not restyle plugin-set colours.

Taxonomy, NEXT, folding, hover intent, placement and hooks are untouched.

### D7. Settings rail: the `settings-nav-rail` subtree only

- Items: `--text-muted` becomes `--text-secondary`, and `min-h-[36px] max-sm:min-h-[44px]`.
- Current item: raw `bg-blue-600/15` becomes `bg-[var(--bg-tertiary)]` + a 3 px `--accent-primary` bar (`before:` on the leading edge from `md`, bottom edge in the strip below `md`).
- Group labels (`:1381`): `--text-secondary`, semibold.
- Sub-item control (`:1437`) and promoted plugin rows (`:1460`): drop `--text-muted` and `opacity-60`, use `--text-secondary`, and keep the "↗ <group>" hint at 12 px. The glyph is existing copy and stays.
- Services attention dot (`:1416`): becomes a 14 px `mdiAlertCircleOutline` in `--severity-error-fg`; its `sr-only` count text stays.
- The dirty indicator (`nav-dirty-<id>`, `:1426`) keeps its dot shape and `title`, but its raw `bg-amber-400` becomes `bg-[var(--severity-warning-fg)]`.
- The other dirty indicators and plugin health dots keep their shape and labels, with any raw colour replaced by a severity token.

The no-raw-colour check for the rail runs on the rendered `settings-nav-rail` element in a component test, because the rest of the file holds 39 pre-existing hits.

### D8. Guards (baselined first)

- **Before any code edit (task 1.2):** add `packages/client-utils/src` and `packages/dashboard-plugin-runtime/src` to `SCAN_ROOTS`. Record existing findings with `--write`. This baseline growth records pre-existing sites only and lands in the same commit as the root addition. From then on the baseline only shrinks.
- **Which guard catches what:**
  - `theme-token-guard` catches token fallbacks, undeclared tokens and accent-as-text.
  - `aligned-surfaces-no-literals.test.ts` catches raw palette classes and hex/`rgba` in classes and styles.
- **Scan list additions.** The scan test gains roots for `client-utils` and `dashboard-plugin-runtime`, and these paths:
  - `client-utils/src/StatusPill.tsx`
  - `client-utils/src/Dialog.tsx`
  - `dashboard-plugin-runtime/src/settings-fields.tsx`
  - `client/src/components/session/SessionActionsPanel.tsx`
  - `client/src/components/settings/ProviderHealthPill.tsx`
  - `client/src/components/packages/plugin-row-parts.tsx`
  - `client/src/components/settings/services/services-ui.tsx`
  - `client/src/components/settings/vault/vault-ui.tsx`
  - `client/src/components/settings/vault/OperateRequiredCallout.tsx`

  Each file is scanned whole. Task 1.2 records the pre-migration scan of these files; any hit outside the migrated blocks is fixed in this change (expected: few, since all but `StatusPill.tsx`, `Dialog.tsx` and `ProviderHealthPill.tsx` scan clean today).
- **`theme-system` exposure.** Joining the list makes `theme-system` "Readable text on aligned action surfaces" apply to these files. Task 10.2 probes them.

### D9. Contract rows match shipped code; adoption-pending rows are marked

`ui-contract.md` rows come from the board's rows page, amended to match the code. Pill: 11 px, 12 px in interactive. Notice: `text-xs` with copy-only details.

Rows for patterns with no reference implementation in this change (tabs, filter chip, loading / empty / first-run, row overflow beyond `SessionCard`) cite their source change and carry "Adoption: pending (plugin wave)". Readers then know which existing surfaces do not conform yet. Skill edits come last and only reference contract rows.

## Risks / Trade-offs

- **[Visual shift in every palette]** Pills, dialogs and the rail change colour, including base dark and light (D2). → Intended. Screenshots in base dark, base light and nord dark go in the PR; the probe gates contrast.
- **[Default icons crowd tight rows]** For example plugin-list rows. → Icons are 11 px-scale (`size 0.5`), and rows apply the R8 overflow recipe where they wrap.
- **[Dialog restyle touches every dialog]** Plugin dialogs already built on `ui:dialog` (flows, KB, quota, gmail, automation board) inherit the new look now; this is intended. Hand-built plugin overlays stay out of scope. → No prop or behaviour change, existing suites, and a harness capture per size.
- **[`theme-system` now covers the newly listed files]** Its readable-text rule keys off the `message-severity-tokens` list. → The listed files are exactly the ones this change brings to the contract; task 11.2 probes them. Files not on the list (for example `pi-core-version-ui` Core rows) are unaffected.
- **[Kit API grows]** `remedies`, `aria-busy` and `SettingsActionError` become public runtime API. → All additive; `doubt-driven-review` on the props before they stand (task 10.3).
- **[11 px pill vs the 12 px interactive floor]** → The kit already switches to 12 px inside interactive elements; the probe covers both.
- **[Plugin-set colours inside the menu]** → The host only sets the inherited colour. A plugin that paints `--text-tertiary` itself still fails contrast; the plugin wave owns that.
- **[ArtifactChip / `statusPresentation`]** → The helper keeps `--status-*` (`client-utils-status-presentation` MODIFIED). The pill change does not touch it.

## Kit props doubt review (task 2.5, 2026-10-18)

Fresh-context, cross-model: `@propose-review-1` then `@propose-review-2` (both non-Claude, probed clean), artifact = the `settings-fields.tsx` diff, no author reasoning. 2 cycles, stop condition met (cycle 2: no blocking findings).

**Fixed**
- Non-error notices had no role, against the spec ("other tones as status") and leaving `aria-busy` inert. `SettingsNotice` now defaults to `role="status"` (error stays `alert`; explicit `role` wins). The one intended default change in the kit; the 18 `ByRole("status")` consumers still pass.
- "Copy failed" was a silent label swap. `SettingsCopyButton` now has a standing `sr-only` `role="status"` live region. It renders a fragment (button + span); no caller targets the root.
- `SettingsNotice` cognitive complexity went 16 → 17. Extracted `RemedyList` and `NoticeActions`; it is now under the cap.
- D3 said the copy failure label "exists"; it did not. Added `settingsField.copyFailed` (en fallback, hu, zh-CN).
- Test hygiene: the clipboard stub is restored in `afterEach`.

**Accepted trade-offs**
- `spinning` is a no-op without an icon, and rotates whatever glyph is shown. Documented on the prop: pair it with `mdiLoading`. `ui:status-pill` does this for `running`.
- `SettingsActionError` does not enforce one sentence or id uniqueness. The caller owns both; documented (derive the id from the row id).
- `remedies` filtering stays with callers (D3). Positional keys: a remedy list is static per failure.
- The kit holds no pending state: `retrying` is caller-driven. **Task 4.2 carries the check** that the vault retry sets `retrying` synchronously, so two fast clicks send one request (test #X4).
- Each `SettingsCopyButton` adds an unnamed `role="status"` region. A "Copy failed" announcement follows the user's own click on a focused button, so the focus supplies the context. A plugin test that asks for a single `status` role on a page with several copy buttons would need `within()`.
- No `failedLabel` prop, no accessible name on the remedy list, no size cap on `details`, and the width jump on copy: nits.

**Noise**
- "`ui:status-pill` has no `spinning`": the public props are frozen and `running` passes `spinning` internally (task 3).
- "`motion-reduce:` may be missing from plugin builds": the host compiles one stylesheet with `@source "../../dashboard-plugin-runtime/src"` (`packages/client/src/index.css:17`).
- "plugin-row load error needs a unique `SettingsActionError` id": that consumer is a `SettingsNotice`.

### Cycle 3: kit props added during the migration (2026-10-18)

Migrating vault and services needed five more additive `SettingsNotice` props, because the existing tests and the vault spec pin test ids, `data-remedy` values and a named list: `icon` (tone-icon override, e.g. the lock), `remediesLabel` (list name, default "What you can do"), `remedyTestId` (every row), `retryTestId`, and remedy `id` (→ `data-remedy`, also the key). `retrying={false}` now reports `aria-busy="false"` (absent when `retrying` is omitted). Exported type `SettingsRemedy`. Reviewed by `@propose-review-2` on the delta, with the real consumers named: no blocking findings.

- **Accepted, second intended default change:** a caller that already passes a boolean `retrying` now gets `aria-busy="false"` instead of no attribute. Identical for assistive tech; the vault spec and its tests require the explicit `"false"`.
- **Noise:** "id-less rows lost `data-remedy=""`": `remedies` is new in this change, so nothing on develop relied on it. "Label default is English-only in core": core renders inside `PluginContextProvider` (`App.tsx:3059`), so `settingsField.remediesLabel` translates (hu, zh-CN added).
- **Nits accepted:** duplicate ids fail soft (both callers dedupe); `retryTestId` replaces the derived id by design.

## Migration Plan

Client-only, with no protocol, settings or persisted-state change. Order:

1. Guard roots and baselines.
2. Kit extensions.
3. `ui:status-pill`.
4. Services and vault.
5. Remaining pills.
6. Dialog.
7. Menu.
8. Rail.
9. Scan list.
10. Contract.
11. Skills.

Rollback is a revert.
