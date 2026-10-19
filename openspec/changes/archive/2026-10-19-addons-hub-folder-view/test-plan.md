# Test Plan — addons-hub-folder-view

Stage: design   Generated: 2026-10-17

Hard gate resolved (ask_user): catalog perf budget p95 < 300 ms @ 50 features + 500 loose files; failed toggle → switch reverts, strip unchanged, inline row error; Discover lists `off-here` features with "installed globally, off here" + "Turn on here".

Exemplars: server L1 → `packages/server/src/__tests__/resource-activation-toggle.test.ts` (pure writer, temp HOME/cwd), `packages/server/src/__tests__/resource-activation-routes.test.ts` (Fastify inject, trust); client L1 → `packages/client/src/components/__tests__/UnifiedPackagesSection.health.test.tsx` (fetch mock), `packages/client/src/components/__tests__/DirectorySettings.test.tsx`; L3 → `tests/e2e/addons-hub.spec.ts`, `tests/e2e/resource-activation-trust.spec.ts`, `tests/e2e/retro-ux-plugin-settings-forms.spec.ts` (computed-contrast probes).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | folder catalog › roll-up | decision-table | L1 | automated | one-package global feature × project entry ∈ {none, normal, all-empty `autoload:false`, `{autoload:false, skills:["-x"]}`} × global toggle ∈ {on, off}; plus a feature with no pi part | joiner called with `scope=local` | folderState = inherited / added-here / off-here / partly-off-here; global off + no entry → `off-globally`; global off + all-empty delta → `off-here`; no pi part → `dashboard-only` |
| E2 | folder catalog › multi-package roll-up | decision-table | L1 | automated | feature with packages X,Y; all-empty delta for X only, then for both | joiner | `partly-off-here`, then `off-here` |
| E3 | folder catalog › identity rule (D8) | EP | L1 | automated | `<cwd>/.pi/settings.json` `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }`, global feature whose source is the absolute `<cwd>` | joiner | feature `added-here`, reports 1 loading extension of its total (not `inherited`) |
| E4 | folder catalog › missing/unparseable file | EP | L1 | automated | (a) no `<cwd>/.pi/settings.json`; (b) file content `{ "packages": [` | GET catalog | (a) every global feature `inherited`/`dashboard-only`/`off-globally`, 200; (b) 200 with `settingsError` set, no added/off states |
| E5 | folder catalog › counts | EP | L1 | automated | `<cwd>/.pi` with 29 skills, 2 agents, 1 prompt; global package contributing 3 agents | GET catalog | loose counts `{skills:29, agents:2, prompts:1, extensions:0, themes:0}`; that feature reports 3 package agents |
| E6 | folder catalog › cwd admission | EP | L1 | automated | cwd `repo` (relative); cwd `/a/../b` (unnormalised); absolute cwd not known to `admitCwd`; known but untrusted cwd | GET catalog (route inject) | 400; 400; `admitCwd` rejection status; 200 with states (not trust-gated) |
| E7 | folder toggle › write form | EP | L1 | automated | `pkg:pi-web-access` global, `/repo` trusted, no project entry; snapshot bytes of `~/.pi/agent/settings.json` | POST toggle `{scope:"local", cwd:"/repo", enabled:false}` | project file contains exactly `{ "source": "npm:pi-web-access", "autoload": false, "extensions": [], "skills": [], "prompts": [], "themes": [] }`; global file bytes identical; one log line naming feature, cwd, source |
| E8 | folder toggle › plugin feature | EP | L1 | automated | `plugin:goal` (plugin + managed bridge + `npm:@ricoyudog/pi-goal-hermes`, plugin requires its own package) | POST toggle off for `/repo` | only the pi-goal-hermes delta written; `keptOn` empty; plugin `goal` still enabled; no bridge entry written |
| E9 | folder toggle › keptOn | decision-table | L1 | automated | X belongs to feature A; feature B requires X, B state ∈ {on, partial, off} | POST toggle A off | B on/partial → 200 `changed:false`, `keptOn:[{X,[B]}]`, file unchanged; B off → delta written |
| E10 | folder toggle › record-and-restore | state-transition | L1 | automated | `/repo` entry `{ "source": "npm:pi-web-access", "autoload": false, "skills": ["-skills/a"] }` | off → off → on | after second off the record still holds the original; after on the entry deep-equals the original and the record is gone |
| E11 | folder toggle › notOwned + removeUnowned | state-transition | L1 | automated | (a) all-empty delta with no record; (b) normal entry `"npm:pi-web-access"` with no record | on; then on with `removeUnowned:true` | (a) `notOwned`, entry kept → then removed; (b) `removeUnowned` never removes the normal entry |
| E12 | folder toggle › edited after off | state-transition | L1 | automated | off written, then entry hand-edited to `{source, autoload:false, skills:[]}` | on | entry unchanged, record deleted, `notOwned`; on with `removeUnowned:true` removes it |
| E13 | folder toggle › 4xx matrix | decision-table | L1 | automated | features `dashboard-only`, `off-globally`, `core:pi`, `added-here`, unknown id | POST toggle off | 400, 400, 400, 400, 404; no file or record written |
| E14 | folder toggle › relative global source | EP | L1 | automated | global entry `{ "source": "../src/my-ext" }` in `~/.pi/agent/settings.json` | POST toggle off for `/repo` | project delta `source` is the absolute path resolved from `~/.pi/agent`; catalog then reports `off-here` |
| E15 | folder toggle › canonical key | EP | L1 | automated | `/tmp/link` → symlink to `/tmp/real` | off via cwd `/tmp/link`, on via cwd `/tmp/real` | on restores the recorded entry (record found under the realpath key) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | folder catalog › perf budget | tail-latency (timed) | L1 | automated | 50 features, 500 loose `.pi` files in a temp cwd | p95 < 300 ms of the folder-catalog join | 30 iterations after 3 warm-ups |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | page › strip arithmetic | EP | L1 | automated | mocked catalog: 31 global pi features (none off globally), 1 folder package, 29 loose skills, 1 feature `off-here` | render folder Add-ons page | strip reads 31 from Global · 1 + 29 files added here · 1 turned off here · total 31 add-ons + 29 own files |
| F2 | page › global-off excluded | EP | L1 | automated | F1 data + 1 feature off globally that also has the all-empty delta here | render | strip counters identical to F1 |
| F3 | page › switch success | state-convergence | L1 | automated | From Global row `pkg:pi-web-access` on; toggle mock 200 | click "on here" switch | row shows `off in this folder`, "turned off here" +1, no navigation/reload, session-reload offer visible for `/repo` sessions |
| F4 | page › failed toggle | state-convergence | L1 | automated | toggle mock 409 `{error:"settings unparseable"}` | click switch | switch back on, strip unchanged, row shows "settings unparseable" inline |
| F5 | page › keptOn / notOwned replies | decision-table | L1 | automated | toggle mock replies (a) `changed:false, keptOn:[{X,["plugin:B"]}]`; (b) `notOwned` on enable | click switch; (b) confirm "Remove this folder entry" | (a) switch stays on, row names `plugin:B`; (b) confirm dialog shows the entry, then exactly one retry with `removeUnowned:true` |
| F6 | page › row rendering | EP | L1 | automated | catalog with a `partly-off-here` feature, an `off-globally` feature, an off-here plugin feature with 3 package agents, a `dashboardManaged` bridge | render | partly row `aria-checked="mixed"` + "partly off here"; off-globally switch disabled + "turned off globally"; plugin row says dashboard UI stays + agents still load; bridge only as `bridge` chip, never a row; Dashboard-only group collapsed |
| F7 | page › filters | EP | L1 | automated | catalog with 1 added-here, 2 off-here, 5 inherited | toggle `Added here`, `Turned off here`, type text "web" | groups narrow to 1 / 2 / text matches only |
| F8 | page › Added group + files row | EP | L1 | automated | 1 folder-installed package; 29 loose skills | render | row offers update + uninstall (`usePackageOperations` local); "Your files in .pi/" row shows counts and links to `/folder/:cwd/settings/skills` |
| F9 | page › Discover | decision-table | L1 | automated | recommended entries: R1 no feature, R2 `off-here`, R3 `inherited` | open Discover; click R1 install; click R2 "Turn on here" | R1 listed + install dialog scope radio = `local`; R2 listed with "installed globally, off here" + toggle `enabled:true` call; R3 not listed |
| F10 | page › trust flow | state-transition | L3 | automated | docker harness, untrusted folder, default `ask` | turn a From Global row off in `/folder/<cwd>/settings/add-ons` | trust dialog opens; Approve → `POST /api/resources/trust` 200 (challenge registered) → toggle retried → row `off in this folder` |
| F11 | page › end-to-end off/on | state-convergence | L3 | automated | docker harness folder with original `.pi/settings.json` bytes captured; trusted | switch a From Global feature off, reload page, switch it on | after off: strip "turned off here" = 1 and file holds the delta; after reload state persists; after on: file bytes equal the original |
| F12 | Issues › plugin issue | EP | L1 | automated | plugins list: `apple-tools` enabled with unresolved `${imcpServerPath}` | render Add-ons page + Settings rail | Issues tab lists Apple Tools with the missing requirement and settings link; rail Add-ons item badge ≥ 1 |
| F13 | Issues › no issues | EP | L1 | automated | no plugin issues; health all `ok` | render | Issues tab shows "No issues"; rail item has no badge |
| F14 | Issues › health panel move + count | EP | L1 | automated | health: 2 stale + one 4-member duplicate group; 1 plugin issue | render, open Issues tab | `PackageHealthPanel` renders inside Issues tab and not above the installed list; tab count and rail badge = 1 + 6; no `pkg-health-badge` header badge (migrate `UnifiedPackagesSection.health.test.tsx`) |
| F15 | Issues › cleanup refreshes count | state-convergence | L1 | automated | F14 data; cleanup mock 200, health refetch returns all ok | check stale rows, Apply | exactly one `POST /api/packages/cleanup`; count re-fetched → tab and rail = 1 |
| F16 | Issues › rendered rail + tab | state-convergence | L3 | automated | docker harness with a plugin missing a requirement | open `/settings/add-ons?tab=issues` at 1440 and 375 | rail badge visible with the same number as the tab; panel inside tab |
| F17 | Issues › retro UX contrast (task 4.4) | computed-contrast probe | L3 | automated | `PackageHealthPanel` with stale/missing/duplicate fixtures | render in base dark, base light, nord dark | every probe in `tests/e2e/helpers/computed-contrast.ts` passes; panel `data-testid`s unchanged |
| F18 | page › visual conformance | visual/subjective | — | manual-only | folder Add-ons page + Issues tab | compare dark/light at 375/1440 against `mockups/extensions-hub/folder.html` and `index.html` | [judgment: matches mockup layout and copy] |
| F19 | Issues › retro UX as-built capture (task 4.4) | visual/subjective | — | manual-only | `PackageHealthPanel` stale/missing/duplicate/clean states | capture base dark/light + nord dark at 375/1440 before and after conforming | [judgment: conforms to the Issues tab mockup, tokens per `ui-contract.md`] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | folder toggle › trust prompt | fault-injection (abort) | L1 | automated | `/repo` no trust record, default `ask`; also an inherited refusal from a parent | POST toggle off | 403 `trustRequired:true`; no file/record written; follow-up `POST /api/resources/trust` for `/repo` returns 200 (not 409) |
| X2 | folder toggle › trust refused | fault-injection (abort) | L1 | automated | (a) refusal recorded for `/repo`; (b) `defaultProjectTrust: never` | POST toggle off | 403 without `trustRequired`; nothing written |
| X3 | folder toggle › unparseable project file | fault-injection (abort) | L1 | automated | `/repo/.pi/settings.json` = `{ "packages": [` | POST toggle off | 409; file bytes unchanged; no record |
| X4 | folder toggle › write failure rollback | fault-injection (abort) | L1 | automated | settings flush throws EACCES (injected) | POST toggle off over an existing narrowing entry | error response; no restore record from this call remains; file unchanged |
| X5 | folder toggle › lock | fault-injection (delay) | L1 | automated | two features A, B in `/repo`; first write delayed 200 ms | two concurrent POST toggle off | both deltas present in the final file; two records |
| X6 | Issues › health fails | fault-injection (abort) | L1 | automated | `GET /api/packages/health` → 500 / network error | render Issues tab | only plugin issues listed; no error text; tab count = plugin issues |
| X7 | real pi load | fault-free runtime | — | manual-only | isolated env (non-8000 ports, temp HOME), `pi-web-access` installed globally | turn it off in folder A, start sessions in A and B; re-enable | [judgment: loaded only in B; `.pi/settings.json` back to original — needs a real pi + extension, no harness fixture] |

---

## Coverage summary

- Requirements covered: 6/6 (folder catalog, folder toggle, folder page, Issues tab, package-health MODIFIED, perf budget)
- Scenarios by class: edge 15 · perf 1 · frontend 19 · error 7
- Scenarios by level: L1 35 · L2 0 · L3 4 · manual 3
- Scenarios by disposition: automated 39 · manual-only 3

## New infra needed

- none (P1 is a timed vitest; L3 rows reuse the docker harness + `computed-contrast.ts`).
