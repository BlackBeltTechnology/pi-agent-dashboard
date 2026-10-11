## 1. Tests first
- [x] 1.1 build-site embeds `ui.plans[SCR-order]` and `ui.styleKit`; refuses an orphan plan (names it, no HTML)

## 2. Implementation
- [x] 2.1 `lib.mjs` `readUi` reads plans + style kit; `checkUi` refuses orphan plans
- [x] 2.2 catalog: screen-page plan frame (sandboxed srcdoc), open-in-tab, `screen-plan-open` message, Style kit page + header button
- [x] 2.3 `SKILL.md`, `AGENTS.md` rows

## 3. Pilot
- [x] 3.1 Pilot app catalog rebuilt with the two plans + kit, verified in the browser

## Notes

- Pilot (pilot project `ui-extract/`, node:test 8/8): style kit from 12 app stylesheets (148 colour tokens, 10 font stacks, 13 components, all cited); plans SCR-order (56 controls) and DLG-task-set-done (6), 0 unlinked; two runs byte-identical.
- Found while verifying: a `//` "comment" in plan.css produced a broken declaration that made the browser drop every later rule (only 194 of 534 rules applied) — invalid declarations are now dropped like browsers do; the app is a full-window flex layout, so plans render in a fixed 1366×768 frame; Calibri gets a metric-compatible fallback in the plan only (kit tokens unchanged; `--sk-font-base` references the token).
- Catalog: plan frame verified; a legend action link inside the sandboxed plan opened `#view=scr:SCR-order&f=ACT-order-add-line` with the action expanded; Style kit page shows 148 swatches and 13 components.
