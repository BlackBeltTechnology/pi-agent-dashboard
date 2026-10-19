# Test Plan — align-ui-contract-recipes

Stage: design   Generated: 2026-10-18

No clarification gaps: every Triple filled from the specs and design.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-status-recipes › one status pill; client-utils-status-presentation › covered surfaces | decision-table | L1 | automated | `ui:status-pill` with each `state` ∈ {running, success, info, warn, error, muted}, no `icon` | render | tone classes `--severity-{info,success,info,warning,error,neutral}-*` respectively; each renders an `svg` icon; `data-status-pill` = raw state; no `style` attribute carrying a colour |
| E2 | shared-status-recipes › default icon on cold load | EP | L1 | automated | `ui:status-pill` state `warn`, `icon="mdiFlaskOutline"`, `useMdiIconByKey` mocked to return `null`, then the path | render, then resolve the key | first render shows the warning default icon path; after resolution shows the flask path; unknown key `"mdiNope"` keeps the default |
| E3 | shared-status-recipes › progress icon respects reduced motion; settings-panel › kit `spinning` | decision-table | L1 | automated | `SettingsStatusPill tone="info" spinning` | render | icon has `animate-spin` and `motion-reduce:animate-none`; without `spinning` neither class |
| E4 | shared-status-recipes › pill size | BVA | L1 | automated | `SettingsStatusPill` outside and inside a `SettingsItem` summary | render | `text-[11px]` outside, `text-[12px]` inside |
| E5 | settings-panel › kit notice extensions | EP | L1 | automated | `SettingsNotice` with `remedies` = [A, B, C] where B's content holds `<a href="/auth/login">` | render | three rows in order A, B, C; the link is focusable; existing props-only render is byte-identical to the pre-change snapshot |
| E6 | credential-vault › remedy order survives | decision-table | L1 | automated | `operate_required` body with remedies `request-access`, `unknown-value`, `sign-in` | vault load refused | notice rows: request-access then sign-in; no row for `unknown-value`; "Request access" and sign-in links present |
| E7 | services-settings-ui › Service detail page (refused action) | EP | L1 | automated | `POST /api/services/postgres/stop` mocked to 409 `{code:"stop_failed", message:"permission denied"}` | click Stop | `role=alert` element with id referenced by Stop's `aria-describedby`; visible text lacks `stop_failed`; Copy-details payload contains `stop_failed` and `permission denied` |
| E8 | shared-status-recipes › raw code stays out | EP | L1 | automated | plugin row with `status: "waiting_peers"` and a `loadError` stack "Error: Cannot find module…" | render plugin list | visible word "Waiting for peers"; `data-status="waiting_peers"`; stack text absent from visible text, present in Copy-details payload; no `text-[10px]` class in the row |
| E9 | client-utils-status-presentation › settings surfaces | EP | L1 | automated | `ProviderHealthPill` in states ok / not-tested / error with an `errorLine` | render | rendered via `SettingsStatusPill` (data-tone set); `data-testid="health-pill"` and `data-state` unchanged; error raw text only in Copy-details payload; no `text-(green\|yellow\|red)-400` class |
| E10 | dialog-system › visual baseline, header slot, action intents, close size | decision-table | L1 | automated | `Dialog` with title+icon, `Dialog.Action intent` ∈ {primary, danger, neutral}, `Dialog.Cancel` | open | overlay `bg-[var(--bg-overlay)]`; panel `bg-[var(--bg-secondary)] border-[var(--border-secondary)] rounded-xl`; title `text-lg font-semibold`; tile `--severity-info-*`; primary `bg-[var(--accent-solid)]`; danger `--tint-red-*` and not `bg-red-600`; actions, Cancel and close carry `min-h-[44px] sm:min-h-[36px]`; root on `z-dialog` |
| E11 | session-actions-menu › text and targets | decision-table | L1 | automated | menu for a session with a disabled New worktree (`cwdMissing`), a group with 2 rare items, a plugin claim rendering a plain `<button>` | open menu | headings `text-[11px] font-semibold` `--text-secondary`; items `min-h-[36px] max-sm:min-h-[44px]`; disabled reason in its own block element, `text-xs`, referenced by `aria-describedby`; More… and count not `--text-tertiary`; plugin container sets `text-[var(--text-primary)]` |
| E12 | settings-panel › rail | decision-table | L1 | automated | `/settings/services` active, 1 service needing attention, a dirty page `vault`, a promoted plugin row | render panel | Services has `aria-current="page"` + tertiary fill + bar class; attention marker is an `svg` with the `sr-only` count text; `nav-dirty-vault` has no `bg-amber-400`; promoted row has no `opacity-60`; scan of the rendered `settings-nav-rail` HTML finds no palette class or hex/rgba |
| E13 | message-severity-tokens › surface list | EP | L1 | automated | the 9 design-D8 files + existing list | run `aligned-surfaces-no-literals.test.ts` | passes; reintroducing `bg-red-600` in `Dialog.tsx` makes it fail naming that file |
| E14 | client-build-config › guard covers shared packages | EP | L1 | automated | fixture file under each new root containing `var(--accent-primary, #60a5fa)` | run `scan()` with the new `SCAN_ROOTS` | the fallback is reported as a new violation for both roots |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none: rendering cost unchanged (proposal Discipline Skills); the `MutationObserver` removal only lowers work | — | — | — | — | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | shared-status-recipes › palette change recolours | state-transition | L3 | automated | Services page with a warning pill, harness | switch theme base dark → nord dark via Settings → Appearance | pill computed `color`/`background-color` equal nord's `--severity-warning-*` values without reload; computed-contrast ≥ 4.5:1 |
| F2 | shared-status-recipes, dialog-system, session-actions-menu, settings-panel › contrast floors | computed-contrast probe | L3 | automated | Services page (rail, pills, notice), vault page, session actions menu, one dialog per intent | probe each in base dark, base light, nord dark; then 6 other named themes | 0 text < 4.5:1 in the three gated themes; 0 text < 3:1 in the others; 0 text < 11 px (12 px interactive) |
| F3 | settings-panel › mobile strip; session-actions-menu › touch targets | BVA | L3 | automated | 375×800 viewport | open `/settings/services`; open a session actions menu | Services strip item ≥ 44 px tall with bottom-edge bar; every menu item ≥ 44 px; `scrollWidth === clientWidth` |
| F4 | settings-panel › desktop rail height | BVA | L3 | automated | 1280×800 viewport | open `/settings/general` | every `settings-nav-rail` button ≥ 36 px tall |
| F5 | dialog visual parity with approved board | visual/subjective | — | manual-only | dialog, menu, rail in base dark/light, nord dark | human compares with `mockups/index.html` S1–S3 | [judgment: matches the approved board] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | shared-status-recipes › copying fails | fault-injection (abort) | L1 | automated | `navigator.clipboard` undefined; second case `writeText` rejects | click Copy details on a `SettingsActionError` | button shows the failure label, never "Copied" |
| X2 | shared-status-recipes › retrying notice is busy | state-transition | L1 | automated | `SettingsNotice` with `onRetry` returning a pending promise, `retrying` driven by it | click Try again twice | notice `aria-busy="true"` while pending; retry button disabled; `onRetry` called once |
| X3 | credential-vault › vault callouts; operate-required-remedy › other failure | fault-injection (abort) | L1 | automated | `GET /api/vault` → 500 `{error:"boom"}`; second case 403 `operate_required` without remedies | load vault page | "Couldn't load the vault: …" line shown, no notice element (both cases) |
| X4 | credential-vault › operate-required callout busy | fault-injection (delay) | L1 | automated | `operate_required` with remedies, retry request held open | click retry in the callout | callout notice `aria-busy="true"`, retry disabled, exactly one request sent |

---

## Coverage summary

- Requirements covered: 17/17 (every ADDED / MODIFIED requirement in the change's specs)
- Scenarios by class: edge 14 · perf 0 · frontend 5 · error 4
- Scenarios by level: L1 18 · L2 0 · L3 4 · manual 1
- Scenarios by disposition: automated 22 · manual-only 1

## New infra needed

- none. L3 rows extend `tests/e2e/services-settings.spec.ts`, `tests/e2e/session-actions-menu.spec.ts` and `tests/e2e/severity-contrast.spec.ts` with `tests/e2e/helpers/computed-contrast.ts`.
