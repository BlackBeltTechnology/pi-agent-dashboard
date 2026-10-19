# Harvest — chat-gateway (`packages/chat-gateway/src/client/ChatGatewaySettings.tsx`, 385 lines + `team-controls-panel.tsx`, 287 lines)

## Purpose
Discord gateway config: on/off, threading, mirroring, bot token, cwd gating (allowedRoots/default/fixed map), access tiers, steer prefix, board visibility. Plus read-only pairing hint, bindings table, team-controls surface + command log.

## Structure
1. Root `<div class="space-y-3" data-testid="chat-gateway-settings">` — `:187`. No heading (good: no title/id dup).
2. Intro `<p>` "Drive dashboard pi sessions from Discord. Inert until a bot token is set; every new session's cwd must be inside `<code>allowedRoots</code>`." — `:188-191`.
3. 3 checkbox rows (Enabled / thread-per-conversation / mirror) — `:193-221`. "Enabled" overlaps host enable toggle (separate config key `enabled`).
4. Token password input — `:223-234`.
5. allowedRoots textarea — `:236-245`; Default cwd input `:247-255`; Fixed map textarea `:257-267`.
6. 3-col grid (Allowlist / Admins / Group channels) `sm:grid-cols-3` — `:269-297`.
7. Steer prefix input `:299-307`; board-visibility select `:309-321`.
8. Save row: button + inline notice — `:324-341`. Save sits MID-page; read-only blocks follow below it.
9. "Pairing (L1)" label + hint span — `:344-350`.
10. "Bindings" label + table or empty text — `:352-379`.
11. `<TeamControlsPanel />` — `:382` → `team-controls-panel.tsx`:
    - loading div `:191-196`; header row "Team controls" (xs medium) + disarm-state word + Re-arm btn + write notice `:201-228`;
    - config-error `<p>` `:230-237`; "ceiling X · allowedRoots a, b" line `:239-242`;
    - per-workspace `Binding` cards (bordered `rounded border p-2`) `:65-155`: name + "ceiling · mirror", unbound/problem notes, channel, Principals list, Roles list w/ `Delegation`, Folders list w/ inert flag;
    - "Command log (newest first — the dashboard is the only place it is readable)" + table/empty `:251-284`.
No groups/sections; one flat stack ~14 controls then 3 read-only blocks.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Enabled | native checkbox | `enabled` (dflt true) | none | — | none |
| One thread per conversation (new channel message → new thread + session) | native checkbox | `threadPerConversation` (dflt true) | none (hint baked into label) | — | none |
| Show dashboard sessions on Discord (one thread each; sends their activity to Discord) | native checkbox | `mirrorDashboardSessions` (dflt false) | none (in label) | — | none |
| Discord bot token | native input type=password autoComplete=off | `token` (writeOnly) | placeholder only: "Leave blank to keep the current token" | — | blank → not sent `:170` |
| allowedRoots (one path per line — mandatory) | native textarea rows=3 | `allowedRoots[]` | none (in label) | — | `parseLines` `:34-39`; "mandatory" not enforced client-side |
| Default cwd (still gated by allowedRoots) | native input | `defaultCwd` | none | — | none |
| Fixed map — one `<code>channelKey=cwd</code>` per line | native textarea rows=3 | `fixedMap{}` | placeholder "discord:123456789:-=/repos/proj" | — | `parseFixedMap` `:48-60` silently DROPS malformed lines |
| Allowlist (L1 users) | native input | `allowlist[]` | none | — | `parseList` comma/newline `:27-32` |
| Admins (L2 bind) | native input | `admins[]` | none | — | same |
| Group channels (L4 opt-in) | native input | `groupChannels[]` | none | — | same |
| Steer prefix (mid-turn override) | native input `max-w-[8rem]` | `steerPrefix` (dflt "!") | none | — | none |
| Chat sessions on the board | native select `max-w-[16rem]`: "Hidden (show with "show hidden")" / "Shown" | `sessionVisibility` (dflt hidden) | none | — | none |
Label/hint mixed: jargon (L1/L2/L4, allowedRoots, channelKey) in labels.

## Status & read-only displays
- Save notice `chat-gateway-notice` 11px: ok "Saved." `--text-secondary`; error = raw `err.message` in `text-[var(--danger-text,var(--text-secondary))]` `:334-339`.
- Pairing hint 11px `--text-tertiary`: "A DM from an unknown user is paired only when it matches the current pairing code. The code is printed to the server log at gateway startup (never returned over the API)." `:346-349`.
- Bindings table 11px, header `--text-tertiary`, cols channel/session/cwd/source; cells `truncate max-w-[8rem|12rem]` `:355-374`. Empty: "No bound channels." / "Bindings appear once the gateway is configured and running." `:376-378`.
- Team disarm state 11px: "DISARMED — action requests are refused" (danger-text fallback) vs "armed" (`--text-tertiary`) `team-controls-panel.tsx:203-212`.
- Config error: "Configuration rejected — the layer is running FAIL-CLOSED: {configError}" danger `:230-237`.
- Binding card: "(workspace missing)", "ceiling {c} · mirror {m}" tertiary; unbound "This workspace no longer exists. The binding is retained but inert; its channel is kept."; "Provisioning problem: {p}"; "channel `<code>`" / "No channel provisioned."; "None mapped."; inert folder "inert — outside allowedRoots" `:65-155`.
- Delegation: "Cannot list who can assign this — missing permission: {perm}" (danger) / "Nobody can assign this role." (tertiary) / "Assignable by a, b" `:39-63`.
- Log table cols when/principal/verb/outcome/reason; `toLocaleString()` `:28-30,261-282`; empty "No activity recorded.". Outcome = raw string, no pill.

## Actions
- Save — `chat-gateway-save`, plain bordered (secondary look, should be primary), disabled while busy; no confirm `:325-333`.
- Re-arm — `team-rearm`, small bordered, only when disarmed; writes `teamControls.disarmed=false`; no confirm `team-controls-panel.tsx:214-221,183-189`.

## Save model
Explicit own Save button (NOT host Save bar; no `useSettingsDraftSource`). `save()` `:152-181` sends `plugin_config_write` `:172`; per-field dirty set `:94` guards hydration `:113-126`. Team panel writes via `TEAM_CONFIG_MESSAGE` lane, reply notice "Saved." / "Refused: {reason}" `:168-175`.

## States
- Loading config: fields show defaults, no indicator.
- Bindings unavailable (route unregistered when unconfigured): fetch fail swallowed `:135-137` → "Bindings appear once the gateway is configured and running."
- Busy: Save disabled only, no label change.
- Saved: "Saved."; error: raw message.
- Team: "Loading team controls…" `:193-195` (forever if no reply); empty "No workspace bindings configured." `:245-247`.
- Not-configured (no token): only intro sentence says "Inert until a bot token is set"; no status pill.

## Protected
testids: `chat-gateway-settings`, `chat-gateway-enabled`, `chat-gateway-thread-per-conversation`, `chat-gateway-mirror-dashboard-sessions`, `chat-gateway-token`, `chat-gateway-allowed-roots`, `chat-gateway-default-cwd`, `chat-gateway-fixed-map`, `chat-gateway-allowlist`, `chat-gateway-admins`, `chat-gateway-group-channels`, `chat-gateway-steer-prefix`, `chat-gateway-session-visibility`, `chat-gateway-save`, `chat-gateway-notice`, `chat-gateway-pairing-hint`, `chat-gateway-bindings`, `chat-gateway-bindings-empty`, `team-controls-panel`, `team-disarm-state`, `team-rearm`, `team-write-notice`, `team-config-error`, `team-bindings-empty`, `team-log-empty`, `team-log`, `team-log-row`, `team-binding-${ws}`, `team-binding-name-${ws}`, `team-binding-unbound-${ws}`, `team-binding-problem-${ws}`, `team-principals-${ws}`, `team-roles-${ws}`, `team-folders-${ws}`, `team-folder-inert-${ws}-${path}`, `delegation-unavailable-${role}`, `delegation-none-${role}`, `delegation-members-${role}`. Attr `data-inert`.
aria: none. Keyboard: none. i18n: NONE — all strings hard-coded English.

## Off-contract
- **Tailwind classes never generated**: `packages/chat-gateway` missing from `@source` list `packages/client/src/index.css:16-31`; built CSS lacks `sm:grid-cols-3` (`:269` → grid never goes 3-col), `max-w-[8rem]` (`:305,367,368`), `max-w-[12rem]` (`:369`), `text-[var(--danger-text,var(--text-secondary))]` (`:337`, team `:44,83,92,145,207,233`) → error text renders inherited colour. Other classes only work because core uses them too.
- `--danger-text` token does not exist (fallback only) — `:337` etc.; should be `--severity-error-fg`.
- `--text-tertiary` for readable text: pairing hint `:346`, empty states `:376`, team many (`:52,76,99-103,224,240,245,257`).
- Labels are `<span>` not `<label htmlFor>`: `:224,237,248,258,271,280,289,300` (only select wrapped in `<label>` `:309`).
- No hints / no `aria-describedby` anywhere; hint text crammed into labels.
- Native checkboxes `:194,204,214`, native select `:311`, raw inputs/textarea w/ local `field` class `:183`.
- Literal code in labels: `<code>allowedRoots</code>` `:190`, `<code>channelKey=cwd</code>` `:258`.
- Raw error message shown `:177`; raw `reason`/`configError`/`missingPermission` strings `team:46,93,173,235`.
- Mid-page Save button before read-only blocks; status uses words not pills; outcome column unstyled.
- `bg-[var(--bg-primary)]` inputs inside host card (contract uses `--bg-tertiary` `CONTROL_BASE`).

## Kit mapping
- Intro `<p>` → plain text or `SettingsNotice tone=info` (inert-until-token).
- Checkboxes → `ToggleField` ×3 (move parenthetical to `hint`).
- Token → `TextField` (type password; needs `type` prop — check kit) hint "Leave blank to keep…".
- allowedRoots / Fixed map → `TextAreaField` (hint carries format; error for dropped lines).
- Default cwd, Allowlist, Admins, Group channels, Steer prefix → `TextField`.
- Board visibility → `SelectField`.
- Groups: `SettingsGroup` "Connection" / "Workspace gating" / "Access" / "Behaviour".
- Save: host Save bar via `useSettingsDraftSource` (replace own button + notice).
- Pairing hint → `SettingsNotice tone=info`.
- Bindings table, team-controls cards, delegation, command log → custom (needs read-only table/status recipe); disarm state → status pill recipe + `SettingsNotice tone=error` when DISARMED / configError.
