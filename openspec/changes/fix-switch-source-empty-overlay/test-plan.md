# Test Plan — fix-switch-source-empty-overlay

Stage: design   Generated: 2026-11-17

The hard gate passed: no unfillable triple.

The switch-source L1 tests live at `.pi/skills/switch-extension-source/scripts/__tests__/switch-source.test.ts`:
- `purge`/`detect` take in-memory objects.
- `cmdSwitch` uses temp-dir `paths = { global, project, pkgs }`, with `pkgs` holding a fake `kb-extension/package.json` (`name: @blackbelt-technology/pi-dashboard-kb-extension`, `pi.extensions: ["src/extension.ts"]`).
- `process.exit` is stubbed to throw.

The check's L1 tests extend `scripts/__tests__/check-pi-settings-paths.test.mjs`. `REPO` below means the temp repo root, i.e. `dirname(dirname(projectPath))`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Removing… SHALL NOT leave an empty filter / leftover repo-root entry | state-transition (incident residue) | L1 | automated | project `{ "packages": [{ "source": "..", "extensions": [] }], "flows": { "editFlow": true } }` | `cmdSwitch("npm", "kb-extension")` | written project JSON deep-equals `{ "flows": { "editFlow": true } }`; global holds `npm:@blackbelt-technology/pi-dashboard-kb-extension` |
| E2 | same / last overlay path removed | state-transition | L1 | automated | project `{ "packages": [{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }], "skills": ["-skills/x/SKILL.md"] }` | `cmdSwitch("local", "kb-extension")` | project JSON deep-equals `{ "skills": ["-skills/x/SKILL.md"] }`; global holds `REPO/packages/kb-extension` |
| E3 | same / remaining paths kept | equivalence partition (non-empty after strip) | L1 | automated | root entry `extensions: ["+packages/kb-extension/src/index.ts", "+packages/extension/src/bridge.ts"]` | `purge` for kb-extension | entry kept; `extensions` deep-equals `["+packages/extension/src/bridge.ts"]` |
| E4 | same / other resource filter kept | decision table (empty ext × non-empty sibling) | L1 | automated | root entry `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"], "skills": ["some/skill"] }` | `purge` for kb-extension | entry deep-equals `{ "source": "..", "skills": ["some/skill"] }` |
| E5 | same / every empty array on root removed | decision table (empty ext × empty sibling) | L1 | automated | root entry `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"], "skills": [] }` as the only entry | `purge` for kb-extension | project has no `packages` key |
| E6 | Repair SHALL leave everything else unchanged | decision table (non-candidates) | L1 | automated | project `packages`: `[{source:"npm:x", autoload:false, extensions:[]}, {source:"npm:other-pkg", extensions:[]}, "npm:bare", {source:".."}, {source:"..", extensions:["+packages/extension/src/bridge.ts"]}]` | `purge` for kb-extension | `packages` deep-equals the input (all 5 entries, same order) |
| E7 | same / empty packages list | BVA (list length 0) | L1 | automated | project `{ "packages": [] }` | `purge` for kb-extension | project has no `packages` key |
| E8 | same / root resolution, absolute form | equivalence partition (source spelling) | L1 | automated | entry `{ "source": REPO, "extensions": [] }` | `purge` with the project path | entry removed; no `packages` key |
| E9 | same / root resolution, non-root relative | BVA (one level too far) | L1 | automated | entry `{ "source": "../..", "extensions": [] }` | `purge` with the project path | entry kept unchanged |
| E10 | No written repo-root entry carries an empty resource filter | invariant over fixtures | L1 | automated | each project fixture from E1–E9 | `purge` for kb-extension | for every result, no entry with `source` resolving to `REPO` and `autoload !== false` has an empty `extensions/skills/prompts/themes` array |
| E11 | One source per package / local→npm | state-transition | L1 | automated | global `packages: ["npm:a", "REPO/packages/kb-extension", "REPO/packages/kb-extension/src/extension.ts"]` | `cmdSwitch("npm", "kb-extension")` | global `packages` deep-equals `["npm:a", "npm:@blackbelt-technology/pi-dashboard-kb-extension"]` |
| E12 | One source per package / npm→local | state-transition | L1 | automated | global `packages: ["npm:@blackbelt-technology/pi-dashboard-kb-extension"]` | `cmdSwitch("local", "kb-extension")` | global `packages` deep-equals `["REPO/packages/kb-extension"]` |
| E13 | Leftover overlay entries still report and clean up | state-transition | L1 | automated | project `{ packages: [{ source: "..", extensions: ["+packages/kb-extension/src/index.ts"] }] }`, global without kb | `detect`, then `cmdSwitch("npm", "kb-extension")` | `detect` returns `local (project overlay)`; afterwards global has the `npm:` entry and project has no `packages` key |
| E14 | An unchanged project file is not rewritten | equivalence partition (no-op) | L1 | automated | project `{ "flows": { "editFlow": true } }` (raw bytes recorded) | `cmdSwitch("npm", "kb-extension")` | project file bytes identical; no `settings.json.bak-switch-*` next to the project file |
| E15 | Repo check SHALL reject a committed empty filter / findings say what to fix | equivalence partition | L1 | automated | raw `{"packages":[{"source":"..","extensions":[]}]}` | `emptyFilterViolations(".pi/settings.json", raw)` and `main()` on it | one violation `{ kind: "empty-filter", source: "..", key: "extensions" }`; `main` returns 1; stderr contains "remove the empty key or the entry" and neither `"source": ".."` correction nor `pi install` |
| E16 | same / each resource key | decision table (4 keys) | L1 | automated | 4 raws, one per key `extensions/skills/prompts/themes` set to `[]` on `{source:".."}` | `emptyFilterViolations` | exactly one violation each, `key` equals that key |
| E17 | same / delta exempt | decision table (autoload:false) | L1 | automated | raw `{"packages":[{"source":"npm:x","autoload":false,"skills":[]}]}` | `emptyFilterViolations` | `[]` |
| E18 | same / clean input passes | equivalence partition | L1 | automated | raw `{"packages":["npm:a",{"source":"..","extensions":["+packages/extension/src/bridge.ts"]}]}` | both rule fns | both return `[]` |
| E19 | same / absolute keeps its hints | regression | L1 | automated | raw `{"packages":[{"source":"/Users/someone/repo","extensions":["+a.ts"]}]}` | `absoluteSourceViolations` and `main()` | one violation `kind: "absolute"`; stderr contains the `"source": ".."` correction and the `pi install` note |
| E20 | same / mixed file | decision table (absolute × empty) | L1 | automated | raw with one absolute entry and one `{source:"..", extensions:[]}` | `main()` | 2 violations reported; correction and note each printed exactly once |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Tool SHALL NOT offer a project-overlay mode | illegal transition | L1 | automated | user asks for the removed flag; global+project files exist (bytes recorded) | `cmdSwitch("local", "kb-extension", true, paths)` | stubbed `process.exit` called with 1; logged message contains `local`; both files byte-identical; no `*.bak-switch-*` in either dir |
| X2 | Switch SHALL succeed when project settings are absent | fault-injection (missing file) | L1 | automated | project path does not exist | `cmdSwitch("local", "kb-extension", false, paths)` | no exit call; global holds `REPO/packages/kb-extension`; project path still absent; no project `.bak-switch-*` |
| X3 | Object and malformed entries do not break a switch | fault-injection (malformed input) | L1 | automated | global `packages: [{ "source": "npm:other-pkg", "skills": ["-x"] }]`; project `packages: [null, { "extensions": [] }]` | `detect`, then `cmdSwitch("npm", "kb-extension")` | no throw; the global object entry and both project entries are written back unchanged; global gains the `npm:` kb entry |
| X4 | Repo check findings / unparseable file | fault-injection (corrupt file) | L1 | automated | raw `{"packages": [` | `absoluteSourceViolations`, `emptyFilterViolations`, `main()` | first returns 1 finding `kind: "parse"`; second returns `[]`; `main` returns 1 and prints no correction or `pi install` note |
| X5 | Every edited file backed up, valid JSON | fault-injection (overwrite) | L1 | automated | global file with known prior content | `cmdSwitch("npm", "kb-extension")` | exactly one `settings.json.bak-switch-<digits>` beside the global file with the prior bytes; the new global file passes `JSON.parse` |
| X6 | Bridge no longer shadowed (end-to-end) | live verification | — | manual-only | real repo with project `{source:"..", extensions:[]}` and the global `REPO/packages/extension` entry | run `switch-source.ts npm kb-extension`, then spawn a dashboard session in the repo | [judgment: requires the live dashboard and the real `~/.pi` — session registers, no new `REGISTER_TIMEOUT` line in `~/.pi/dashboard/sessions/spawn-failures.log`] |

---

## Coverage summary

- Requirements covered: 9/9 (one source per package · repair · leave-unchanged · no overlay mode · absent project file · backup + JSON · check rejects empty filter · check findings hints · object/malformed entries)
- Scenarios by class: edge 20 · perf 0 · frontend 0 · error 6
- Scenarios by level: L1 25 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

- Vitest project `.pi/skills/switch-extension-source` (config plus root registration), task 1.1. It reuses the existing vitest/forks setup, and no new harness is needed.
