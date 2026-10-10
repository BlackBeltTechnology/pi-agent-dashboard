## MODIFIED Requirements

### Requirement: Rendered deck exposes a measurement hook
The rendered HTML SHALL expose `window.__deck3d` with `gotoSlide(n)`, `setTime(t)` (deterministic animation clock), `ready()` (resolves after camera arrival and one rendered frame) and `measure()` returning, for every labelled object on the current slide (title, bullets, diagram nodes/edges/actors/messages, props, and text items drawn by `slide-layer` with kind `layer-text`), its projected screen rect in CSS px, its label cap height in px, its kind and id, and the first raycast hit between camera and label centre. It SHALL also expose `fonts()` returning `{ fallbacks: string[] }`, the sorted, de-duplicated names of fonts the deck drew with a fallback. `ready()` SHALL additionally wait until every deck asset is decoded.

#### Scenario: Measurement is stable
- **WHEN** `measure()` is called twice at the same slide and `setTime` value with a fixed viewport
- **THEN** both results are identical

#### Scenario: Layer text is measured
- **WHEN** `measure()` is called on a settled slide that uses `slide-layer`
- **THEN** every drawn text item of that slide appears with kind `layer-text` and its layout item id
