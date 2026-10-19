## Why

Wave 1 (`retro-ux-plugin-settings-forms`) put the shared settings field components (the "field kit": `FieldShell`, `ToggleField`, `SettingsGroup` and the rest) into `dashboard-plugin-runtime`. Only three plugin pages use it so far (context-mode, hermes, Gmail). The other 15 plugin settings pages still each draw their own fields. On 2026-10-18 the live instance showed 12 different field layouts across sibling pages. Some text is unreadable in light theme: the Anthropic Messages Bridge status bar uses hard-coded zinc colours. The Cost page's inputs have no border. Browser Relay is a 5 008 px wall of fully expanded profiles. Status shows as 10 px words or raw codes such as `OS_TOO_OLD`, and save behaviour differs from page to page. Measured with the wave-1 probe rules, the as-built bodies fail contrast or size 774 times across base light, base dark and nord dark. The proposed board fails 0 times. The host chrome around every page also shows developer data (the `claims:` chip) and uses text styles that `ui-contract.md` forbids.

## What Changes

- Mockup: `mockups/plugin-settings-wave-2.html` (in this change). It covers 16 surfaces and 44 states, shows the as-built page next to the proposal, and has base dark, base light and nord dark themes. Supporting files:
  - `mockups/ui-plan.md`: 89 findings, the save-model table and the protected list.
  - `mockups/audit.md`: measured numbers and decisions A1–A8 (approved 2026-10-18).
  - `mockups/harvest/<id>.md`: source facts with line references.
  - `mockups/asbuilt/*.png`: live captures.
- **Every plugin settings body uses the runtime field kit.** This covers apple-tools, automation, blackhole, browser, chat-gateway, cost-estimator, flows-anthropic-bridge, grammar, quota, mcp-client, system-one, obs-studio, goal, flows and subagents. Native checkboxes, selects and hand-rolled label/hint layouts are replaced. Data-testids, i18n keys, settings keys and file formats stay the same.
- **New kit members:**
  - `SettingsStatusPill`: severity tone, icon and a human word.
  - `SettingsItem`: a repeatable card for things like a profile, instance, server or binding, with an optional collapsible body.
  - `SettingsFacts`: a read-only term/value list.
  - `SettingsTable`: a read-only table.
  - Kit fix: the `SettingsGroup` summary meta text goes from 11 px to 12 px, which the interactive-text floor requires.
- **Bodies never repeat the plugin's identity.** Duplicated title and id headers are removed from apple-tools, flows-anthropic-bridge, grammar, quota and system-one. A switch inside a body that looks like the host "Enabled" switch gets a label saying what it actually does, such as "Relay connections" or "Answer Discord messages".
- **One save model for configuration.** Config fields go through the host Save bar. This changes:
  - chat-gateway: its own mid-page Save button goes.
  - flows-anthropic-bridge: its own Save button goes.
  - cost-estimator: no longer writes on every keystroke.
  - apple-tools: the path field no longer writes on blur.

  Actions with side effects keep saving immediately: tokens, Connect, Start/Stop and the MCP editor modal. They gain error feedback scoped to the item that failed.
- **Status and errors.**
  - Raw enums and codes become status pills with a human word.
  - Raw error text becomes a sentence plus "Try again", with the raw detail behind "Copy details".
  - Literal backticks render as code.
  - Contradictory controls are merged. The two Anthropic bridge gate checkboxes become one three-way gate (Automatic · Always on · Off), still stored in the same two env-var keys.
- **Host chrome (`PluginSettingsPage`).**
  - The `claims:` chip appears only with Developer ▸ "Show plugin internals".
  - The status pill appears only when the plugin is unhealthy, with human words.
  - The native `enable` checkbox becomes a labelled "Enabled" switch.
  - Colours use severity tokens instead of `--accent-*` fills.
  - The "← Plugins" link moves from the bottom of the page to a breadcrumb at the top.
  - The card root becomes `rounded-xl` with a `text-lg` title.
  - The body gets a host wrapper with one consistent vertical rhythm.
- **Build and lint.**
  - Add the 10 missing `@source` lines (the 8 in scope plus roles and demo) in `packages/client/src/index.css`. This is the root cause of grammar's missing padding and chat-gateway's missing grid.
  - Extend `scripts/theme-token-guard.mjs` to scan every plugin client tree.
  - Add a ratchet lint for settings components. It flags native checkboxes and selects, raw colours, text below 11 px, and bodies that repeat their title or id. Baselines only shrink.

## Capabilities

### New Capabilities
- `plugin-settings-consistency`: rules every plugin settings body follows. It composes from the runtime kit, renders no identity header, gives in-body switches distinct labels, puts config on the host Save bar, shows status as pills, keeps raw errors behind details, and is enforced by the kit-adoption ratchet lint plus `theme-token-guard` coverage of every plugin tree.

### Modified Capabilities
- `settings-panel`: the kit gains `SettingsStatusPill`, `SettingsItem`, `SettingsFacts` and `SettingsTable`; the `SettingsGroup` summary meta goes to 12 px.
- `dashboard-plugin-loader`: the "settings-section claims render only under the owning plugin's row" chrome text changes the same way. Slot ids move behind the Developer toggle in both the full and compact chrome, status pills use human words, and the enable control becomes an "Enabled" switch.
- `dashboard-shell-slots`: the "settings-section slot hosts plugin-owned settings UI" chrome changes. Slot metadata appears only behind the Developer toggle, the status pill appears only when unhealthy, there is a labelled Enabled switch, a breadcrumb back link, and a host body wrapper.
- `browser-plugin-settings`: collapsible profile cards, status pills, a "Relay connections" switch, per-profile write errors, and a collapsed Activity group.
- `flows-anthropic-bridge-settings`: a tone-based status notice with a loading state, a status-pill table, a three-way gate that replaces the two toggles, and the host Save bar.
- `grammar-settings-plugin`: kit groups and fields, no identity header, a "Check grammar in the composer" label, a min < max check and a load-error notice.
- `mcp-client-settings`: one primary "Add server" button, row metadata as pills, and a live status pill.
- `system-one-settings-ui`: no duplicate heading, `SettingsGroup` instead of nested cards, button hierarchy, and human error text.
- `provider-quota-surfacing`: the terms-of-service warning becomes a visible notice instead of a tooltip, and the settings controls move to the kit.
- `client-build-config`: the Tailwind `@source` requirement also covers plugins whose client code sits directly in `src/`, and a repository test fails when any plugin with settings UI has no covering `@source` line.
- `apple-tools-provisioning`: the provisioning state is shown as a pill plus a fix-naming notice, and the path field joins the host Save bar.

## Impact

- **Runtime:** `packages/dashboard-plugin-runtime/src/settings-fields.tsx` (new members plus the meta fix) and its barrel.
- **Contract:** `ui-contract.md` documents the four new kit recipes and the 12 px group-meta exception; `dashboard-plugin-scaffold/references/host-design.md` updated with it.
- **Client:**
  - `packages/client/src/components/settings/PluginSettingsPage.tsx` and `packages/client/src/components/packages/plugin-row-parts.tsx` (colour fragments).
  - A Developer-page toggle for "Show plugin internals".
  - 8 `@source` lines in `packages/client/src/index.css`.
- **Plugins:** the 15 settings components listed in `mockups/ui-plan.md`, and new `useSettingsDraftSource` ids `plugin:chat-gateway`, `plugin:flows-anthropic-bridge`, `plugin:cost-estimator` and `plugin:apple-tools`.
- **Scripts:** `scripts/theme-token-guard.mjs` scan roots and baseline, and a new settings-kit ratchet with its baseline and tests.
- **Tests:** existing component tests keep their testids. New tests cover the kit members, the host chrome, and per-plugin save-model moves. A Playwright capture spec on the harness checks every board state × 3 themes with the probe, using `page.route` fixtures; real provisioning flows stay manual checks.
- **No change to:** REST or WebSocket protocol, settings keys, file formats.
- **Rollback:** revert.

## Non-goals

- New settings, new validation rules beyond the ones listed (chat-gateway required folders and channel-map syntax, grammar min < max, cost ranges, automation retention ≥ 1, visible messages for the existing system-one add-backend checks).
- Redesigning the MCP server editor modal beyond a re-skin. Its schema-key labels are a follow-up.
- The three wave-1 plugins (context-mode, hermes, Gmail) and the KB folder pill.
- Core settings pages outside `/settings/plugins/<id>`, except one new Developer-page toggle ("Show plugin internals", A1).
- The roles and demo plugin bodies (they only gain their missing `@source` line).

## Discipline Skills

- `doubt-driven-review`: before the new kit members stand, because they become a public runtime API. Also before the save-model moves in chat-gateway, flows-anthropic-bridge and cost-estimator, because they change when data is written.
- `review-code`: before commit, because 15+ packages change.
- `security-hardening`: chat-gateway and browser token fields are restyled and move into the host Save bar draft. Check that write-only secrets never enter draft state or a re-render as plaintext, and never appear in "Copy details".
- No `performance-optimization`: rendering cost is unchanged. Browser Relay renders fewer expanded nodes.
