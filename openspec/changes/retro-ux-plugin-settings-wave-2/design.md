## Context

Shared method: wave 1 `retro-ux-plugin-settings-forms` design (D1 consistency is the primary audit axis, D2 the field kit lives in `dashboard-plugin-runtime`). This file records only what is new. The facts below come from `mockups/harvest/*.md`, which cites file and line.

- The host mounts each plugin body as `<div data-testid="plugin-page-body-<id>">` → `PluginSettingsPageProvider` → `SettingsSectionByPluginSlot`. The div has no styling, so every plugin owns its own vertical rhythm (`PluginSettingsPage.tsx:312-317`).
- Host chrome text is 10 px. The id and back link are in `--text-muted`, the enable control is a native checkbox with `accent-blue-500`, and the WARN/ERR/OK/LINK fragments paint `--accent-*` fills as text (`plugin-row-parts.tsx:25-38`). There is no developer-mode flag anywhere in the client. The Developer page holds build and log toggles only.
- 10 plugin trees with a `settings-section` claim have no `@source` line (`packages/client/src/index.css:16-31`), so Tailwind silently drops their classes: the 8 in scope plus `roles-plugin` and `demo-plugin`. `theme-token-guard.mjs` scans `packages/client/src` plus only 3 plugin trees. Its ratchet (per-file counts in a baseline that only shrinks) is the model for a new lint.
- Save behaviour today: host Save bar in 7 plugins, own Save button in 2, a write on every keystroke in 1, a write on blur in 1, immediate REST calls in browser and mcp-client, and localStorage in goal.

## Goals / Non-Goals

**Goals:**
- One field anatomy and one status vocabulary on every `/settings/plugins/<id>` body.
- Configuration saves through the host Save bar. Side-effect actions stay immediate and show their errors.
- The rules hold after this change: a ratchet lint catches drift in new and existing plugins.

**Non-Goals:**
- Converting the MCP server editor modal's raw schema-key labels into human labels. That needs schema metadata; follow-up.
- A per-plugin settings search, or reordering plugins in the rail.

## Decisions

### D1. Board-first: approve the mockup before any component change
The proposal points to `mockups/plugin-settings-wave-2.html`: 16 surfaces, 44 states, as-built captures next to proposed HTML, 3 themes. Decisions A1–A8 in `mockups/audit.md` are approved there before tasks are folded, as wave 1 did. *Rejected:* migrating pages first and reviewing in the app. The pages share one anatomy, so an unapproved choice would have to be redone 15 times.

### D2. Four new kit members, not per-plugin components (A7)
Three or more plugins repeat each pattern:
- status words: browser, chat-gateway, bridge, obs, mcp, apple-tools, quota;
- entity cards: browser profiles, obs instances, chat bindings, mcp servers, system-one backends;
- read-only key/value lists: obs, system-one, chat team;
- tables: bridge, chat bindings and log, grammar recommendations, browser activity.

So `settings-fields.tsx` gains `SettingsStatusPill({ tone, children, icon? })`, `SettingsItem({ title, subtitle?, status?, actions?, collapsible?, defaultOpen?, testId?, children? })`, `SettingsFacts({ rows })` and `SettingsTable({ columns, rows, caption })`. All are presentation only and paint only through tokens on the 11/12/14 px steps.

- A `SettingsStatusPill` always carries a word. The icon is decoration (`aria-hidden`). Colour is never the only signal (WCAG 1.4.1).
- `SettingsItem` with `collapsible` renders `<details>`. The status pills sit in the `<summary>`, so a collapsed card still shows its state.
- *Rejected:* each plugin keeps its own card. That is today's drift. *Rejected:* exposing them through the UI primitive registry, which `plugin-ui-primitive-registry` reserves for shell-bound primitives (wave 1 D2).

### D3. Host owns identity; bodies never repeat it (+ in-body switch naming)
The host chrome renders title, id, status and the Enabled switch. A body SHALL NOT render a heading equal to the plugin's display name or id. A switch inside a body SHALL NOT be labelled "Enabled", "Enable" or "On"; it names what it controls ("Relay connections", "Answer Discord messages", "Check grammar in the composer", "Check quotas"). The config keys stay `enabled`; only the visible labels change.

### D4. Save model: config → host Save bar; side effects → immediate with feedback (A4)
| Kind | Model | Applies to |
|---|---|---|
| Configuration value | `useSettingsDraftSource` → host Save bar | everything that writes `plugin_config_write` or a plugin config-file route |
| Side-effect action | immediate, busy state, per-item error `SettingsNotice` | tokens/keys, Connect/Disconnect, Start/Stop, installer, Re-arm, MCP editor modal Save |
| Per-item setting on a plugin REST route | immediate, busy state, per-item error `SettingsNotice` | browser relay switch (`browser-plugin/src/server/routes.ts:13`), profile zero-dialog / allowed domains, MCP row enable switch |
| Per-browser preference | immediate localStorage, "This browser" pill | goal auto-restart |

New draft ids: `plugin:chat-gateway`, `plugin:flows-anthropic-bridge`, `plugin:cost-estimator`, `plugin:apple-tools`.

- **Commit sends only owned keys.** Today's writers send `{ ...config, ...partial }` snapshots (`CostEstimator.tsx:235`, `AppleToolsSettings.tsx:106`); the server already merges `{ ...existingPluginConfig, ...body }` (`packages/server/src/routes/plugin-config-routes.ts:112`). Drafts send only the keys they edited, so an immediate write elsewhere (the apple-tools installer reconciling a discovered path, another browser tab) is never overwritten by a stale snapshot. Clean drafts adopt `plugin_config_update`; dirty drafts keep edited keys and adopt the rest. Same-key concurrent edits stay last-write-wins, as on every existing draft page.
- **Secrets in plugin config are configuration.** The chat-gateway token goes through `plugin_config_write` with the other fields (`ChatGatewaySettings.tsx:169-173`), so it is a draft value; secrets on a plugin's own route (browser pairing token, system-one key) stay immediate.
- Empty number inputs are an invalid draft value, never coerced to 0 (`CostEstimator.tsx:273,285,297` coerce today).

- The chat-gateway bot token stays write-only. The draft holds only a "replace token" string (today already in `useState`, `ChatGatewaySettings.tsx:73`), cleared after commit, discard and reset, and excluded from "Copy details". A blank token is never sent (as today, `ChatGatewaySettings.tsx:169-171`).
- *Rejected:* making browser profile fields draft-based. They hit the browser plugin's own REST routes, which have no batch write, and a pairing token must be saved alone to be checked. Moving them would also change those routes, which this change does not touch.

### D5. Host chrome changes (A1–A3)
- **A1, slot claims.** A new per-browser preference `showPluginInternals` (localStorage, default off, no dashboard config key) on the Developer page. When on, the full chrome shows a collapsed "Plugin internals" disclosure with the id and slot claims (approved 2026-10-18). The compact chrome for promoted pages (`PluginSettingsPage.tsx:191-217`) keeps its existing "Plugin details" disclosure (id, dependencies, dependents) and lists slot claims there only when the preference is on; this MODIFIES `dashboard-plugin-loader`. *Rejected:* show slot claims in that disclosure for every user on every page; it keeps developer data one click away for everyone.
- **A2, back link.** The breadcrumb "← Plugins" moves above the chrome card: 12 px semibold `--text-secondary`, 32 px target. The testid `plugin-page-back-to-index` is kept.
- **A3, status pill.** Shown only when the plugin is unhealthy: Off / Not loaded / Needs setup / Failed to load. Wave-1 precedent: the compact header's `CompactHealthPill`.
- **Other host changes:**
  - The enable control becomes a `role="switch"` with a visible label "Enabled". Testids are kept.
  - The banners use `SettingsNotice` tones. The `WARN_*`/`ERR_*`/`OK_*`/`LINK_*` fragments map to `--severity-*` tokens, which also fixes the activation-index row.
  - The card root becomes `rounded-xl` and the title `text-lg`.
  - The body wrapper becomes `grid gap-3`.

### D6. Fix the build root cause first
The task order starts with the 10 missing `@source` lines (apple-tools, blackhole, browser, chat-gateway, cost-estimator, flows-anthropic-bridge, grammar, quota, roles, demo). flows-anthropic-bridge, grammar, quota, roles and demo keep their client code in `src/`, not `src/client`, so their lines point at `src/`. roles and demo bodies are not redesigned here (roles was redesigned when promoted to Model roles; demo is a fixture); they only get the build line, so the new repository test passes on day one. Classes that render today because another tree happens to use them stop being accidental.

### D7. Enforcement: a ratchet, not a hard gate (A8)
- `scripts/theme-token-guard.mjs` `SCAN_ROOTS` gains every plugin client tree. Their current counts are baselined with `--write`.
- A new `scripts/settings-kit-guard.mjs`, built on the same `scan` / `ratchet` / `loadBaseline` structure and tested like `theme-token-guard.test.mjs`, scans every module a `settings-section` claim points to (resolved from the manifests) and counts:
  - native `type="checkbox"`;
  - hex, `rgba(`/`rgb(` literals and Tailwind palette colour classes (the theme-token guard does not count these; it checks fallbacks, undeclared tokens and accent-as-text);
  - `<select` outside the kit;
  - `text-[9px]`, `text-[10px]`, `fontSize: 10`;
  - `--text-muted` / `--text-faint` on text;
  - a heading literal equal to the plugin `displayName` or id.

  Counts may only shrink. This change brings all 15 to zero and deletes their baseline entries, so any later regression fails CI.
- The `settings-panel` rule that `hint` is enforced by the type checker, "no source-scanning test", is unaffected: this lint scans for native controls and identity headers, not for hints.

### D8. Copy rules
- Labels say what the control does in plain words. A config term (`allowedRoots`, `channelKey`, env var names) moves into the hint as `<code>`.
- Ranges and units go in the hint and the unit chip, never in parentheses in the label (wave-1 spec).
- Error text is one sentence naming the fix. Raw codes go behind "Copy details" (`ContentCopy` icon).
- No literal backticks reach the UI: i18n strings that wrap code are split around a `<code>` element, as wave 1 did.

### D9. Kit API review (task 2.8, doubt-driven-review before plugins consume it)
Findings on the four new public props, reconciled in `settings-fields.tsx`:
- **No `title` tooltip on `SettingsStatusPill`.** A tooltip-only explanation is the QU3 defect (keyboard/touch can't read it). Dropped; context goes in a visible notice or hint.
- **Raw enum kept as `data-status`, never shown.** `SettingsStatusPill status="waiting_peers"` → `data-status`; existing tests that pin raw states keep a hook without the UI showing the token.
- **Actions never inside a `<summary>`.** A button in a `role=button` summary is a nested interactive element (axe `nested-interactive`) and is the BH5 finding. Collapsible `SettingsItem`s render actions at the top of the body; non-collapsible items keep them in the header row.
- **Pill size follows context.** Pills inside a `SettingsItem` / `SettingsGroup` summary get 12 px automatically (React context), so 15 call sites cannot forget the interactive floor; `interactive` forces it elsewhere.
- **`SettingsTable` caption is required and `sr-only`.** The enclosing group already titles the table visually; the caption names it for assistive tech. Rows carry a stable `key` and optional `testId` so existing row testids survive.

## Risks / Trade-offs

- [Four new public runtime components] → `doubt-driven-review` on their props before they land. They are presentation only, so reverting is cheap.
- [Save-model moves change when data is written; a user who leaves without Save loses edits that used to auto-save in cost-estimator and apple-tools] → the host Save bar already guards leaving (`onLeaveGuard`), and the board shows the unsaved-changes bar in every dirty state.
- [The three-way bridge gate maps onto two env-var keys] → Automatic = both false, Always on = force, Off = disable. What the runtime does when both are true lives in the external `@pi/anthropic-messages` package (unverified here), so the UI does not guess: a loaded both-true state selects no option, shows a warning, and changes nothing until the user picks one.
- [Collapsing Browser Relay profiles hides the token field of profiles without the extension] → those profiles can't connect anyway. The group summary says how many are hidden and why.
- [Ratchet baselines for 15 plugins add churn to `theme-token-baseline.json`] → baselined once in the first task, then driven to zero in the same change.
- [Hiding the `claims:` chip removes a debugging aid] → the Developer toggle restores it (A1). `/api/health.plugins[]` still lists claims.
- [The live as-built probe measures only the current state of each page] → the after-capture runs every board state on the docker harness (wave-1 E24 pattern) with `page.route` fixtures stubbing each plugin's status/config routes (wave-1 D2). These are render-state assertions only. Real provisioning (apple-tools on macOS, Discord, OBS, Chrome extension pairing) stays a manual check, as `tests/e2e/apple-tools-activation.spec.ts:10-13` already notes.

## Migration Plan

None. No settings key, file format or route changes. New draft ids start empty. Rollback is a revert.

## Open Questions

- Should the MCP server editor's schema-key labels get human labels from the schema `title`/`description`? Deferred to a follow-up; not needed for this anatomy.
