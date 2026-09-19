## Purpose

Gives the presenter and the tuning agent an on-deck control panel to try look settings live and export them as `overrides`, without ever mutating the embedded IR or breaking determinism of the rendered file.

## ADDED Requirements

### Requirement: Panel visibility and controls
The rendered deck SHALL contain a configurator panel hidden by default, toggled by a gear button in a screen corner and by the `C` key, closed by `Escape`. The panel SHALL show the slide counter `n / N` and a scope switch **Deck | This slide**. Deck scope SHALL offer `mode`, `palette`, `quality`, `transition`, `durationSec`, `backgroundIntensity`, autoplay (integer seconds per slide, `1`–`600`; `0` = off, the default; other input rejected by the control) and the deck-level effects checklist; slide scope SHALL offer `mode`, `palette`, `quality`, `camera.distance`, `labels.size`, `backgroundIntensity` and the slide's composed effects checklist. A control whose current value comes from an override SHALL carry a `●` marker. With the panel hidden the rendered frame SHALL be pixel-identical to a deck without the panel.

#### Scenario: Toggle
- **WHEN** the presenter presses `C`
- **THEN** the panel appears showing `3 / 23` on slide 3; pressing `Escape` hides it

#### Scenario: Autoplay bounds
- **WHEN** the presenter enters `601` or `0.5` in the autoplay field
- **THEN** the control rejects the value and autoplay state is unchanged; `600` is accepted and the deck advances every 600 s; `0` stops autoplay

#### Scenario: Override marker
- **WHEN** slide `geo` has `overrides.slides["geo"].camera.distance` set
- **THEN** in slide scope on `geo` the `camera.distance` control is marked `●` and other controls are not

### Requirement: Live application without IR mutation
Changing a control SHALL apply to the rendered scene immediately (look, camera, labels, effects composition) and SHALL persist only in memory and browser local storage keyed by the deck's derived hash; the embedded IR object SHALL be unchanged afterwards. Unchecking an effect SHALL remove it from that scope's composed list while preserving the order of the rest. While a panel input has focus, slide navigation keys and the `C` toggle SHALL not fire, and clicks inside the panel SHALL not advance the slide.

#### Scenario: Palette switch
- **WHEN** the presenter selects palette `ember` in deck scope
- **THEN** the current slide re-renders with the `ember` colours and `window.__DECK.defaults.palette` still reads the original value

#### Scenario: Typing in a field does not navigate
- **WHEN** the `durationSec` input has focus and the presenter types `2` then presses `Space`
- **THEN** the field reads `2 ` (or rejects the space) and the slide does not change

#### Scenario: Reload restores panel state
- **WHEN** the deck is reloaded after changing `quality` to `low` in the panel
- **THEN** the panel shows `low` and the scene renders at low quality; a re-parsed deck (different derived hash) starts with no stored panel state

### Requirement: Export overrides
The panel SHALL offer **Export** which downloads `overrides.json` in the IR `overrides` grammar (`deck`, `effects`, `slides{<slideId>}`) containing the scalar keys changed in the panel and, for any scope whose effects checklist was touched, that scope's full resulting effects array. The export dialog SHALL state that markdown inline overrides win over this file and that an exported effects list pins that scope's effects. `deck3d overrides apply <deck.json> <overrides.json>` SHALL deep-merge the file into `overrides` (objects deep-merge; arrays and `diagram.data` replace) and re-validate, exiting non-zero on a validation error with the JSON path.

#### Scenario: Round trip
- **WHEN** the presenter sets slide `geo` to `mode: light` and `camera.distance: 11`, exports, and runs `deck3d overrides apply deck.json overrides.json && deck3d render deck.json`
- **THEN** `overrides.slides["geo"]` contains exactly `{ mode: "light", camera: { distance: 11 } }` and the rendered `geo` slide matches what the panel showed

#### Scenario: Effects list is pinned
- **WHEN** the presenter unchecks one of three default effects on slide `ai` and exports
- **THEN** `overrides.slides["ai"].effects` in the file lists the remaining two effects in original order

### Requirement: Check ignores the configurator
`check` SHALL clear the panel's stored state for the deck before measuring, run with the panel hidden, and SHALL not include panel elements in fit, overlap, occlusion or contrast measurements.

#### Scenario: Panel never in the report
- **WHEN** `check` runs on a deck whose local storage holds panel state from a previous session
- **THEN** the report equals the report for a fresh profile and no finding names a panel element
