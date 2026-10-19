# Test Plan — add-editor-pane-file-handlers

Stage: design   Generated: 2026-10-18

Hard gate passed. Performance: "measure only" (P1 records p95, never fails).

Exemplars by level:

| Level | Exemplar |
|---|---|
| L1 server | `packages/server/src/__tests__/file-write-endpoint.test.ts` |
| L1 client | `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`, `packages/client/src/lib/__tests__/editor-pane-state.test.ts` |
| L1 runtime | `packages/dashboard-plugin-runtime/src/__tests__/editor-pane-tab-claims.test.ts`, `loader.test.ts` |
| L1 shared | `packages/shared/src/__tests__/file-kind.test.ts` |
| L3 | `tests/e2e/editor-pane.spec.ts`; fixture plugin gate `PI_DASHBOARD_FIXTURE_PLUGINS=1` (demo plugin) |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | slot: text-backed rejection | EP | L1 | automated | claims with `.md`, `.markdown`, `.csv`, `.adoc`, `.mmd`, `.puml`, `.txt`, `.json`, `.ts`, `.html` | manifest validation | each throws naming plugin, slot and extension |
| E2 | slot: unrecognised claimable | EP | L1 | automated | claims with `.docx`, `.drawio`, `.psd`, `.svg` | manifest validation | accepted; `isTextBackedExt` false for each (probe path absolute, no throw) |
| E3 | slot: extension format | EP | L1 | automated | `docx`, `.*`, `.tar.gz`, `.DOCX`, `.a` | validation | first four throw; `.a` accepted |
| E4 | slot: id + copy suffix | EP | L1 | automated | duplicate `id: "word"` in one plugin; `id: "a/b"`; edit claim without `copySuffix` | registry generation / validation | each fails naming plugin and field |
| E5 | slot: registry hash | regression | L1 | automated | plugin claim; change only `extensions`, then only `maxBytes`, then only `validator` | `pluginRegistryHash` | hash changes each time; a plugin without file-handler claims keeps its previous hash |
| E6 | slot: predicate classification | type | L1 | automated | `SlotPredicateInput<"editor-pane-file-handler">` | `tsc` type assertion | resolves to `never` |
| E7 | switcher | decision table | L1 | automated | {0, 1, 2 enabled claims for `.docx`} × {plugin priorities 100/1000} | render tab for `report.docx` | 0 → no switcher; 1 → Preview + label; 2 → Preview, then ascending priority, then plugin id |
| E8 | switcher case | EP | L1 | automated | claim `.docx`; files `REPORT.DOCX`, `a.Docx` | render | switcher shown for both |
| E9 | switcher scope | decision table | L1 | automated | {session pane, folder pane} × {file under cwd, file outside cwd but in git common root} | render claimed file | only session pane + under cwd offers the mode; outside cwd shows "outside the session folder"; folder pane has no switcher |
| E10 | built-in not mounted | EP | L1 | automated | `.docx` tab with handler mode selected | render | `DocxPreview` not mounted; no `/api/file/render` request |
| E11 | handlerMode hydration | EP | L1 | automated | stored state with `handlerMode: 42` on tab A, valid string on tab B, unknown claim on tab C | `loadEditorPaneState` + render | A field dropped, tabs kept; B restored; C renders built-in view; other tabs unchanged |
| E12 | write auth | decision table | L1 | automated | {known / unknown cwd} × {target under cwd / `..` escape / symlink outside} × {claim enabled edit / disabled / preview mode} × {ext claimed / not} | `POST /api/file/write-binary` via `fastify.inject` | 200 only for known + under + enabled edit + claimed; else 403, file bytes unchanged |
| E13 | symlink dual extension | EP | L1 | automated | `<cwd>/report.docx` → `<cwd>/notes.md`; `.docx` claim | overwrite | 403; `notes.md` unchanged |
| E14 | size cap | BVA | L1 | automated | claim `maxBytes` = 40 MiB; bodies 40 MiB − 1, 40 MiB, 40 MiB + 1, 128 MiB + 1 | overwrite | first two 200; third 413; fourth rejected by body limit; files unchanged when rejected |
| E15 | content token | state | L1 | automated | snapshot sha1 S; file rewritten with different content and `utimes` restored to the old mtime | overwrite with `expectSha1=S` | 409 with current `sha1`; file unchanged |
| E16 | missing token | EP | L1 | automated | overwrite request without `expectSha1` | POST | 400; file unchanged |
| E17 | missing file | state | L1 | automated | file deleted after snapshot | overwrite | 409 without `sha1` (client hides Reload) |
| E18 | mode preserved | EP | L1 | automated | target mode `0600`; deleted source for a copy | overwrite; copy | overwritten file still `0600`; copy of deleted source gets `0644 & ~umask` |
| E19 | copy naming | BVA | L1 | automated | none / `report.wordcraft.docx` / `-2`…`-99` existing | `mode=copy` | `report.wordcraft.docx`; `report.wordcraft-2.docx`; 100th attempt → 409 "no free name"; no existing file modified |
| E20 | validator scope | EP | L1 | automated | plugin A registers validator for plugin B's claim; module path `../x.js` | `registerFileValidator` | both throw |
| E21 | validator fail-closed | decision table | L1 | automated | claim `validator: true` × {validator registered / plugin enabled but server entry not loaded} × {`enabled()` true / false} | overwrite | registered+true → validator runs; not loaded → 503; `enabled()` false → 403; files unchanged when refused |
| E22 | route tier | EP | L1 | automated | `ROUTE_TIERS` | lookup `POST /api/file/write-binary` | `control`; non-loopback observe bearer → 403 |
| E23 | lock key | state | L1 | automated | `<cwd>/alias.docx` symlink → `<cwd>/real.docx`; text write lock held on realpath | concurrent overwrite via alias and via real path | writes serialized (second sees first's sha1 → 409), never interleaved |
| E24 | read-only v1 | regression | L1 | automated | no handler plugins | existing `EditorPane.test.tsx` suite | all pass unchanged |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | write-binary | tail-latency | L1 | automated | 20 sequential 40 MiB overwrites with a no-op worker validator | p95 end-to-end, recorded only (measure-only, never fails) | one run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | keep-alive | state-transition | L3 | automated | demo fixture handler on `report.docx` (keepAlive), types "abc" | switch to `foo.ts` tab and back | same instance id (no remount counter increment); "abc" present |
| F2 | pane close | state-transition | L3 | automated | dirty fixture handler | close editor pane, reopen | instance id unchanged; edits present |
| F3 | session switch | state-transition | L3 | automated | dirty fixture handler in session A | switch to session B and back | instance id unchanged |
| F4 | eviction | state-transition | L1 | automated | 3 live instances (LRU clean, others dirty) | open 4th | LRU instance unmounted, its tab shows "Resume"; 4th mounted |
| F5 | eviction blocked | state-transition | L1 | automated | 3 live instances all dirty (or `"unknown"`) | open 4th | none unmounted; dialog lists 3 tabs; Cancel → 4th not mounted |
| F6 | non-keepAlive clean/dirty | decision table | L1 | automated | non-keepAlive instance {clean, dirty} | tab becomes inactive | clean → unmounted; dirty → stays mounted hidden, counts toward cap |
| F7 | leave guards | decision table | L1 | automated | instance {true, false, "unknown"} × {mode switch, last-tab close, manual refresh, banner Refresh, conflict Reload} | trigger | false → proceeds; true/unknown → confirm; Cancel keeps instance and edits; banner stays on Cancel |
| F8 | live plugin disable | state-transition | L1 | automated | instance {clean, dirty}; `setEnabledSet` drops the plugin | claims version bump | clean → closed, built-in view; dirty → instance kept with "re-enable or discard" overlay |
| F9 | beforeunload | EP | L1 | automated | {no dirty instance, one dirty, one unknown} | dispatch `beforeunload` | prevented only for dirty/unknown |
| F10 | shared instance | state | L1 | automated | two tabs of `report.docx` same claim/session | first overwrite confirmed in tab A, save from tab B | no second confirmation; one instance |
| F11 | own save no banner | convergence | L3 | automated | fixture handler on `report.docx`, harness watch active | handler overwrite while a touch fires during the in-flight save | no changed-on-disk banner on the tab after save settles |
| F12 | agent change banner | convergence | L3 | automated | fixture handler on `report.docx` (dirty) | out-of-band rewrite of `report.docx` | banner shown; Refresh → confirm → remount with new content; Cancel → banner stays, edits kept |
| F13 | refresh wiring | EP | L1 | automated | active tab in handler mode | header refresh | layer `remount(key)` called after guard; `CappedViewer` not keyed |
| F14 | overlay alignment | convergence | L1 | automated | instance positioned over pane body | `ResizeObserver` callback with new rect | overlay rect equals pane body rect |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | snapshot consistency | fault-injection | L1 | automated | digest returns S1, raw returns bytes of S2, digest returns S2 (3 times) | `snapshot()` | rejects after 3 retries; no handler mount with mixed bytes |
| X2 | snapshot touch | fault-injection | L1 | automated | mtime changes between digests, sha1 equal | `snapshot()` | resolves on first attempt |
| X3 | snapshot oversize | EP | L1 | automated | digest `size` > `maxBytes` | `snapshot()` | rejects `too-large`; no `/api/file/raw` request; no `/api/file` request |
| X4 | validator hang | fault-injection (delay) | L1 | automated | validator `while(true){}` | overwrite | 422 after ≈5 s; a concurrent `GET /api/health` answers within 200 ms during the hang; file unchanged |
| X5 | validator overflow | fault-injection | L1 | automated | 2 workers busy, 8 queued | 11th save | 503; `save()` reason `busy` |
| X6 | validator reject | EP | L1 | automated | validator `{ok:false}` | overwrite | 422; `save()` reason `rejected`; file unchanged |
| X7 | conflict dialog | state-transition | L1 | automated | 409 response | each action | Reload (confirm when dirty) remounts and resolves `cancelled`; Save as copy writes sibling; Overwrite anyway re-reads digest, warns, writes; Cancel resolves `cancelled` |
| X8 | first overwrite | state | L1 | automated | claim with `firstOverwriteNotice` | first overwrite → Cancel; then Overwrite; then third save | Cancel → `cancelled`, file unchanged; Overwrite → written; third → no dialog |
| X9 | conflict e2e | fault-injection | L3 | automated | fixture handler dirty; out-of-band rewrite | handler overwrite | 409 dialog shown; handler still holds edits; Save as copy creates `report.demo.docx` |

---

## Coverage summary

- Requirements covered: 12/12 (editor-pane-file-handlers 7, dashboard-shell-slots 1, internal-monaco-editor-pane MODIFIED 3, size-limit ADDED 1).
- Scenarios by class: edge 24 · perf 1 · frontend 14 · error 9.
- Scenarios by level: L1 42 · L2 0 · L3 6.
- Scenarios by disposition: automated 48 · manual-only 0.

## New infra needed

- Demo plugin (`packages/demo-plugin`, fixture-gated `PI_DASHBOARD_FIXTURE_PLUGINS=1`) gains a minimal `editor-pane-file-handler` edit claim for `.docx` with `keepAlive`, `validator: true`, `copySuffix: "demo"`. Its component is a plain textarea over the snapshot bytes, exposing an instance id. It is used by F1–F3, F11, F12 and X9.
