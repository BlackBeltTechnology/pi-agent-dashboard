# Harvest — obs-studio (`packages/obs-studio-plugin/src/client/ObsSettingsCard.tsx`, 75 lines)

## Purpose
Read-only status card for provisioned OBS instances (state, auth, version, warnings) + link to the OBS panel route `/obs/`. No editable config.

## Structure
Lazy-loaded via `ObsSettings` → `<Suspense fallback={null}>` (`index.tsx:16-22`) — blank while chunk loads.
1. `<section data-testid="obs-settings" aria-label="OBS Studio">` flex-col gap-3 `ObsSettingsCard.tsx:34` (aria-label repeats host title; no visible heading — good).
2. Intro `<p>` muted: "Scenes, virtual camera and recording of the OBS instances provisioned on this dashboard." `:35`.
3. Error `<p role=alert>` `:36`.
4. Loading `<p aria-busy>` `:37`.
5. None block `obs-settings-none`: "No OBS is provisioned yet." + provision hint `:38-43`.
6. Per instance (provisioned state) bordered box `obs-instance-{id}` `:44-67`:
   - id as bold 14px `<div>` (not heading) `:48`.
   - `<dl>` grid: State · {i.state} raw; Authentication · auth text; Version · {obsVersion} (only if live) `:49-62`.
   - exposure warning `<p>` if `exposure === "all-interfaces"` `:63`.
   - recovery-suspended warning `<p>` `:64`.
7. "Open OBS panel" button (once, after all instances) `:68-72`.
Fields `mode`, `reason`, `hint`, `bridge` of `InstanceStatus` (`api.ts:17-28`) not shown.

## Fields
None (no inputs).

## Status & read-only displays
| item | text | class |
|---|---|---|
| state | raw `i.state` string (e.g. `stopped`, `idle`, `failed`, `stop-failed`, `unavailable`) — no label map, no pill | `text-[var(--text-primary)]` xs `:51` |
| auth ok | "Password accepted" | text-primary `:53-54` |
| auth failed | "OBS rejected the stored password. Re-provision with \`pi-obs provision --update\`." | `--severity-error-fg` xs |
| auth unknown | "Not checked yet" | text-primary |
| version | `live.obsVersion` | text-primary |
| exposure warning | "obs-websocket listens on all network interfaces. Block its port for other hosts in the firewall." | `warnText` = xs `--severity-warning-fg` plain `<p>` (no box/icon) `:16,:63` |
| recovery suspended | "Automatic crash recovery is suspended. Answer OBS's prompt on the host, then run \`pi-obs launch --reset-recovery\`." | warnText `:64` |
Strings from `messages.ts:8-37`. `authState()` `api.ts:52-56`: live→ok; `liveError==="auth-failed"` or bridge.lastError match→failed; else unknown.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Open OBS panel | primary `bg-[var(--accent-solid)] text-white` xs semibold, `focus-ring tap-target self-start` `:18,:69-71` | `navigate("/obs/")` (wouter) | no |
No provision / start / retry actions here (live in ObsPanel).

## Save model
None — read-only. No `useSettingsDraftSource`.

## States
- Chunk loading: nothing (`Suspense fallback={null}`).
- Loading: "Loading…" muted `aria-busy` `:37`.
- Load error: "Request failed: {error}" — `{error}` = raw `ApiError.code` or `String(e)` `:30,:36`.
- Empty / not provisioned: "No OBS is provisioned yet." (sm primary) + "Ask the agent to set up OBS (it runs \`pi-obs provision\`), or run \`pi-obs provision\` in a terminal on the OBS computer." (xs secondary) `messages.ts:10-11`.
- Provisioned: instance boxes + Open OBS panel.
- Auth failed: error-coloured dd text only.
No refresh; fetched once on mount `:27-31`.

## Protected
- testids: `obs-settings`, `obs-settings-none`, `obs-instance-{id}`. (Open-panel button has none.)
- aria: section `aria-label={s("title")}`; error `role=alert`; loading `aria-busy=true`.
- Route `/obs/` (shell-overlay-route claim `ObsAppClaim`).
- i18n: `tr(t, key)` over `messages.ts` keys (title, intro, none, provisionHint, openPanel, state, version, auth, authOk, authFailed, authUnknown, exposureWarning, recoverySuspended, loading, error); catalog `src/i18n.ts` exported from client barrel.

## Off-contract
- Literal markdown backticks rendered as text: `provisionHint` `messages.ts:11`, `authFailed` `:17`, `recoverySuspended` `:20` → users see `` `pi-obs provision` ``.
- Raw state enum shown unlabelled `:51`; raw error code in "Request failed: {code}" `:30,:36`.
- `text-white` on primary btn `:18` (non-token; should be on-accent token).
- Warnings as bare coloured `<p>` (no icon/box) `:63-64`; auth failure colour-only + text.
- Instance id rendered as styled `<div>` not heading `:48`.
- `--text-secondary` intro ok; no 10px; no native inputs.
- Primary CTA placed after list, single button for N instances (unclear target).
- No hex/palette classes found.

## Kit mapping
- Intro → host intro paragraph (custom text, 12-13px `--text-secondary`).
- Error → `SettingsNotice tone="error"` (humanised message).
- Empty → `SettingsNotice tone="info"` with commands as `<code>` chips (render backticks as code, not text) — or custom empty-state recipe.
- Instance box → `SettingsGroup title={id} meta={state pill}` or custom (needs recipe: read-only status card w/ key-value `<dl>` + status pill).
- State → status pill recipe (map enum → label + severity).
- Exposure / recovery warnings → `SettingsNotice tone="warning"` inside instance.
- Open OBS panel → primary button recipe (kit has none; needs recipe).
