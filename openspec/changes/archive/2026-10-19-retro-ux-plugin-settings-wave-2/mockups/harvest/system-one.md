# Harvest — system-one (`packages/system-one-plugin/src/client/SystemOneSettings.tsx` 271 + BackendsSection 341, ChainEditor 180, ConsumersSection 138, TestPanel 247, EgressBadge 32, ConfirmDialog 78)

## Purpose
"Decision models (System 1)": off-machine privacy switch, active preset + its backend chain, backend catalog (managed/http/llm, keys, start/stop), per-consumer chain override + Test/calibration.

## Structure
1. `<section data-testid="system-one-settings">` flex-col gap-4, 13px `--text-secondary` `SystemOneSettings.tsx:119`.
2. `<header>`: `<h3>` "Decision models (System 1)" 15px `:121` (DUPLICATES host title); lead `<p>` max-60ch `:122-128`; config path `<code>` 11px mono `:129`.
3. Conflict callout (error severity) + Reload `:132-145`.
4. Card "Where data may go" (`s1-h-privacy`) — custom switch + label + live description `:147-182`.
5. Card "Preset" — radio-card grid (1/2 col) w/ chain preview + Remove per preset `:184-225`; no-usable warning w/ fix buttons `:226-248`; `<h4>` "Default chain for {preset}" + hint + `ChainEditor` `:249-255`.
6. Card "Backends" (`BackendsSection.tsx:242`): uv-missing warning `:246-250` / Windows info `:251-259`; `<ul>` backend rows `:260-337` (id · EgressBadge · Start/Stop · Remove; kind line mono; StatusLine; capabilities `<dl>`; KeyEntry form); `<details>` "Add backend" form `:143-213`.
7. Card "Consumers" (`ConsumersSection.tsx:29-43`): hint; per-consumer `<details>` `:60-136` (summary: id mono, policy pill, ⚠ slow fallback pill, chain source · mode) → `<dl>` declaration, Chain fieldset (radio preset/override + ChainEditor), llm warning, `<h4>` "Test" + `TestPanel`.
Cards share `card` class (rounded-xl, bg-secondary, inset rim shadow) — 4 nested cards inside host card.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Allow off-machine backends | custom `<button role=switch>` h-6 w-11 + `<label htmlFor>` `:152-174` | `allowOffMachine` | dynamic on/off text `s1-switch-off-desc` via `aria-describedby` `:175-178` | — | — |
| Active preset (sr-only legend) | native radio cards `:198-206` | `activePreset` | chain "a → b" or "empty chain" | — | — |
| Backend to add (sr-only) | native `<select>` + "Add to chain" `ChainEditor.tsx:124-154` | `presets.<p>.chain` / consumer override | option suffix "(incompatible: …; off-machine, disabled)" | — | off-machine options disabled |
| Show incompatible backends ({n} hidden) | native checkbox `ChainEditor.tsx:156-166` | UI-only | warning p `:169-177` | — | — |
| Replace key / API key | password input, `<label htmlFor>` `BackendsSection.tsx:101-106` | auth.json `keyRef` (write-only) | "Saved immediately, not with the Save bar. The key is never shown again." (not aria-linked) `:110-112` | — | error replaces hint w/ RAW `ApiError.code` `:92,:111` |
| Kind | native radios ×3 `:156-170` | new backend `kind` | radio labels long | — | — |
| Backend id | input, wrapping label `:171-174` | backends key | none | — | regex `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` + unique `:117,:127`; only `aria-invalid`, no message; submit disabled |
| Engine | native `<select>` 4 opts `:176-184` | `engine[:checkpoint]` | none | — | — |
| URL / Model | inputs `:188-195` | http `url`,`model` | "Only http and https. The URL's host decides…" (not aria-linked) `:196-198` | — | URL protocol check → `aria-invalid` only |
| Role | input dflt `@fast` `:202-205` | llm `role` | none | — | — |
| Use preset ({p}) / Override for this consumer | native radios `ConsumersSection.tsx:94-107` | `presets.<p>.consumers.<id>` | none | — | — |
| Backend to test | native `<select>` `TestPanel.tsx:93-110` | UI | option "(not saved / off-machine, disabled / not running)" | — | — |
| Shadow / Enforce mode | native radios `TestPanel.tsx:133-140` | calibration mode | none | — | — |

## Status & read-only displays
- EgressBadge pill 11px semibold: "☁ Off-machine · {egress}" warning tokens / "⌂ On-machine · {egress}" success tokens / "not saved yet" neutral `EgressBadge.tsx:15-31`.
- StatusLine 12px: shape dot (success-fg circle / `--status-working` diamond / error-fg square / outline circle) + "Ready" / "Starting (first run downloads the model)" / "Installing engine" / "Failed" / "Stopped" / "Unavailable: uv not on PATH" / "Unsupported on Windows" + meta "reason · PID n · n MB · up n min · health hh:mm" `BackendsSection.tsx:27-61`.
- Kind line mono 12px "managed von · ckpt · port n" / "http · model · url" / "chat role @fast" `:21-25,:309`.
- Capabilities `<dl>` 12px: context "{n} tokens", options, language, price "${p} / M tokens (estimated)"; unknown → italic "unknown" `:239-240,:312-331`.
- Key state `<strong>` "set"/"not set" + "stored in ~/.pi/agent/system-one/auth.json"; env: "`{keyRef}` set · from environment variable" `:68-78,:96-100`.
- Chain entry: index, id (line-through if unusable), badge, "skipped: off-machine use is off" / "skipped: runtime unavailable" / "save to classify" `ChainEditor.tsx:55-77`.
- Consumer summary: policy pill neutral 11px; "⚠ slow fallback" warning pill; "override chain/preset chain · enforce|shadow|Test unavailable" (enforce/shadow untranslated) `ConsumersSection.tsx:62-74`.
- Test results `<table>` 12px: Question, Accuracy, AUC, p50, p90, …, cost "$0.0000" `TestPanel.tsx:196-247`; status line `aria-live=polite`.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Reload (conflict) | smBtn secondary | `load(true)` `:141` | no |
| Remove (preset) | smBtn, disabled on active (title tooltip) | draft `withoutPreset` `:212-222` | no |
| Allow off-machine backends / Switch to local-only | smBtn in warning | draft fix `:236-245` | no |
| ↑ ↓ × (chain) | icon btn 32px (44 mobile), aria-labels | reorder/remove; focus kept `ChainEditor.tsx:79-117` | no |
| Add to chain | secondary | append `:147-154` | no |
| Start / Stop | smBtn | immediate `api.managed` `BackendsSection.tsx:272-282` | no |
| Remove (backend) | smBtn (not danger) | draft delete + strip from all chains `:283-306` | no |
| Save key / Replace key | smBtn submit | immediate `api.setKey` `:107-109` | no |
| Add backend | smBtn submit | draft add `:208-210` | no |
| Run Test ({n} cases) / Cancel | btn | eval run, abortable `TestPanel.tsx:112-119` | no |
| Save calibration | btn | shadow: immediate; enforce: ConfirmDialog | `ConfirmDialog` "Enforce {id} for {consumer}?" Cancel focused, Enforce `bg-[--accent-primary-strong] text-white` `ConfirmDialog.tsx:67-72` |
All buttons same `smBtn` look; no primary/danger hierarchy.

## Save model
Hybrid. Draft keys (`allowOffMachine`, `backends`, `presets`, `activePreset`) → host Save bar `useSettingsDraftSource({ id: "plugin:system-one" })` `SystemOneSettings.tsx:97-104`; commit PUT w/ `baseRevision`, 409 → conflict callout `:86-95`. Immediate: key entry, Start/Stop, calibration save. Polls every 2 s while starting/installing `:75-82`.

## States
- Loading: "Loading…" 13px secondary `:112` (no skeleton).
- Load error: "Could not load the System-1 config ({code})." severity-error-fg `:106-111` — raw code.
- Conflict: "Not saved: system-one.json changed on disk after this page loaded (…). Reload to get the current file, then redo your edits."
- No usable backend: `No backend in "{preset}" can be used right now. Every question will return no-backend.` warning `:226-248`.
- uv missing: "Managed backends need uv. Install it (https://docs.astral.sh/uv/), then reload this page." (URL not a link).
- Windows: info notice `:251-259`.
- Consumers empty: just hint, no empty text `ConsumersSection.tsx:39`.
- Test unavailable: "Test unavailable: {reason}" warning `TestPanel.tsx:39-40`; stale: "The config changed on disk. Reload the page, then save again."; other failure literal "error" `:86`.

## Protected
testids: `system-one-settings`, `system-one-load-error`, `system-one-conflict`, `system-one-reload`, `system-one-allow-off-machine`, `preset-{name}`, `delete-preset-{name}`, `system-one-no-usable`, `backend-{id}`, `managed-status`, `key-{keyRef}`, `key-state`, `add-backend`, `consumer-{id}`, `override-{id}`, `llm-warning-{id}`, `{idPrefix}-entry-{i}`, `{idPrefix}-add-select`, `{idPrefix}-show-incompat`, `{idPrefix}-incompat-warning` (prefixes `s1-default`, `s1-ov-{id}`), `test-backend-{id}`, `run-test-{id}`, `save-calibration-{id}`, `results-{id}`.
ids: `s1-h-privacy|preset|backends|consumers`, `s1-switch-off`, `s1-switch-off-desc`, `s1-key-{keyRef}`, `s1-confirm-title`. aria: switch `aria-checked`, sections `aria-labelledby`, role=alert/status/note, `aria-live`, dialog focus trap + Esc.
Draft source id `plugin:system-one`. i18n ns `plugin.system-one.*` (`src/i18n.ts`, zh-CN only found).

## Off-contract
- Duplicated title `<h3>` "Decision models (System 1)" 15px `:121`.
- Raw error codes to users: `loadError` code `:66,:109`; key error `x.code` `BackendsSection.tsx:92`; literal "error" `TestPanel.tsx:86,:184`.
- `bg-white` knob `:167`; `text-white` confirm `ConfirmDialog.tsx:69` (non-token).
- `--accent-primary` border on active preset `:194` (border ok; not text).
- Native radios `:199`, `BackendsSection.tsx:166`, `ConsumersSection.tsx:95,:99`, `TestPanel.tsx:134,:138`; native selects `ChainEditor.tsx:127`, `BackendsSection.tsx:178`, `TestPanel.tsx:95`; native checkbox `ChainEditor.tsx:157`; custom switch not kit `:152-170`.
- Hints not `aria-describedby`-linked: key hint `:110`, http hint `:196`, chain hint `:252`.
- Invalid id/url: `aria-invalid` w/o message.
- Labels: wrapping `<label>` (implicit) for Add-backend fields — acceptable but no kit.
- Untranslated "enforce"/"shadow" `ConsumersSection.tsx:73`; engine option labels hard-coded.
- Card-in-card: 4 elevated cards inside host card; no button hierarchy (Remove backend not danger).
- uv URL plain text, not link.

## Kit mapping
- Header h3 → drop; lead + path → intro paragraph (custom; path as `keyLabel`-style mono).
- Conflict / no-usable / uv / Windows / llm / test-unavailable → `SettingsNotice` (error/warning/warning/info/warning/warning) + action slot.
- Cards → `SettingsGroup` ×4 (Where data may go, Preset, Backends, Consumers).
- Off-machine switch → `ToggleField` (hint = dynamic desc).
- Preset radios → custom (needs recipe: radio-card group w/ secondary action) or `SelectField` if simplified.
- ChainEditor → custom (needs recipe: ordered list reorder; shared w/ blackhole).
- Backend row → custom (needs recipe: entity row w/ status line + badge + actions); EgressBadge → status pill recipe (already severity tokens).
- KeyEntry → `TextField` (password) + action button; hint/error via kit.
- Add backend → `SettingsGroup defaultOpen={false}` + radio group (custom) + `TextField` id/url/model/role (error text) + `SelectField` engine.
- Consumer `<details>` → nested `SettingsGroup`; `<dl>` → custom key-value recipe; TestPanel → custom (select + run + results table recipe); ConfirmDialog → shared dialog recipe.
