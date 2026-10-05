## 1. Reference

- [x] 1.1 `references/ifml-metamodel.json` extracted from OMG IFML-Metamodel.xmi; `references/ifml-mapping.md`

## 2. Tests first

- [x] 2.1 `ifml` writes conforming XMI for a fixture screen (red)
- [x] 2.2 `ifml` exits 2 without UI model; `check-ifml` refuses non-conforming XMI (red)
- [x] 2.3 build-site embeds IFML + XMI; use case lists actions from `ui:` lines (red)

## 3. Implementation

- [x] 3.1 `scripts/ifml.mjs`: `buildIfml`, `ifmlToXmi`, `checkIfmlXmi`
- [x] 3.2 CLI `ifml`, `check-ifml`; site embedding
- [x] 3.3 catalog IFML view, click-through, links, XMI download
- [x] 3.4 SKILL.md, package AGENTS.md

## 4. Verify

- [x] 4.1 tests green, biome clean
- [x] 4.2 Plantifier: XMI written + `check-ifml` PASS; catalog IFML view browser-checked

## Notes

- 2026-10-05 Plantifier: `ui/ifml.xmi` 47 KB, 14 Window, 2 Form, 13 fields, 6 ValidationRule, 21 events, 6 ActivationExpression, 21 Action/ActionEvent, 32 NavigationFlow; `check-ifml` PASS. Independent reader `ifml-moddle` 0.3.1: 0 warnings, 242 typed elements, 32/32 flows resolved; it does not link `activationExpression` (models it as containment; OMG: reference) — documented in `references/ifml-mapping.md`.
- The checker caught a projection error during implementation: `NavigationFlow` carried `name`, but `InteractionFlow` is not a `NamedElement`.
- Browser: IFML view of UC-01+UC-09 (2 screens, 104 elements, 32 flows, 58 clickable); click on the add-order event opens SCR-order with `ACT-order-add-line` expanded ("in flows of UC-01"); UC-01 lists its UI actions and links its IFML view.
