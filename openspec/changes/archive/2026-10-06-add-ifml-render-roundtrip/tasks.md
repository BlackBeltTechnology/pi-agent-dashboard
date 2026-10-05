## 1. Tests first

- [x] 1.1 export carries IFML-DI + trace ids + nested guard; check-ifml accepts DI, refuses dangling `modelElement` (red)
- [x] 1.2 build-site inlines `--ifml-js`/`--ifml-css` (red)
- [x] 1.3 export → ifml-to-ui → export preserves the IFML graph (red)
- [x] 1.4 ifml-diff reports and `--apply` merges an edited file (red)

## 2. Implementation

- [x] 2.1 ifml.mjs: layout + DI, id scheme, nested guard, checker DI handling
- [x] 2.2 ifml-import.mjs: parse XMI → graph, graph → UI model, diff, apply
- [x] 2.3 CLI `ifml-to-ui`, `ifml-diff [--apply]`; build-site `--ifml-js/--ifml-css`
- [x] 2.4 catalog: ifml-js rendering with scope zoom/dim/highlight/click; Mermaid fallback
- [x] 2.5 references/ifml-mapping.md, SKILL.md, package AGENTS.md

## 3. Verify

- [x] 3.1 tests green, biome clean
- [x] 3.2 Plantifier: XMI renders in ifml-js with 0 warnings; catalog view browser-checked; round-trip on the Plantifier export is clean

## Notes

- First render attempt failed in `ifml-js`: trace `Annotation`s without DI ("unknown di <null> for element <ifml:Annotation …>") and the id-referenced `activationExpression` (read as a string → "unknown di <null> for element <undefined>"). Fix: trace moved into dot-separated ids, guard nested, DI generated.
- Real editor round-trip (Plantifier, ifml-js 0.3.0 modeler in the browser, edits via `modeling.updateLabel` + `removeElements`, `saveXML`): the editor writes `uml:name`, element-valued `body`/`language`/`isModal` and numeric character references; before the dialect fix every name read as empty. After: diff = exactly the rename + the removed event + its flow; `--apply` on a package copy keeps 8 effects and cites, deletion only reported.
- Bugs found by the round-trip, each red-tested first: XML entities not decoded in attribute values (labels with quotes); a dialog without an opening action re-imported as a duplicate screen.
- Plantifier: `ui/ifml.xmi` 64 KB with DI; `run-pilot.sh` step 9 export → `ifml-diff` = no differences; catalog IFML view rendered by ifml-js (UC-01+UC-09: 140 shapes, 32 connections, 12 highlighted; `DLG-task-set-done` scope: 114 dimmed; click on the OK action opens its screen with the action expanded).
