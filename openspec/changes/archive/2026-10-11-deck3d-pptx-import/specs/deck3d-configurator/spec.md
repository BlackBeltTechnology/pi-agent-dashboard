## MODIFIED Requirements

### Requirement: Panel visibility and controls
The rendered deck SHALL contain a configurator panel hidden by default, toggled by a gear button in a screen corner and by the `C` key, closed by `Escape`. The panel SHALL show the slide counter `n / N` and a scope switch **Deck | This slide**. A control whose current value comes from an override SHALL carry a `●` marker. With the panel hidden the rendered frame SHALL be pixel-identical to a deck without the panel.

Controls SHALL be grouped into collapsible blocks, each independently openable and closed by default except the first: **Look** (`mode`, `palette`, `colors.card`/`colors.accent`/`colors.secondary`, `material`), **Lighting & FX** (`bloom`, `rimLight`, `fog`, `mirrorFloor`, `softShadows`, `envReflections`, `backgroundIntensity`), **Camera & labels** (`camera.distance`, `labels.size`, `depthRelief`, `extrudeDepth`), **Layout** (`layout`; `rail` and `spacing` deck scope only; `diagram.kind`, `diagram.scale`, `diagram.offset.x`, `diagram.offset.y`, `cardOffset.x`, `cardOffset.y` slide scope only), **Motion** (`transition`, `durationSec`, autoplay — integer seconds per slide, `1`–`600`; `0` = off, the default; other input rejected by the control), **Quality** (`quality`) and **Effects** (that scope's effects checklist). A block offering no control in the active scope SHALL be omitted. Each block's open/closed state SHALL persist in local storage beside the staged values and SHALL survive a scope switch, a slide change and a reload.

Within the **Effects** block, each composed effect SHALL render a control per parameter DECLARED IN ITS CARD — generated from the declaration, never hand-written per effect, so corpus and `local:` effects alike gain controls by declaring params. A declared `minimum`/`maximum` SHALL render a slider bounded by them, a `boolean` a checkbox, and an `enum` a select. Editing a parameter SHALL re-instantiate that effect on the current slide immediately, SHALL NOT mutate the authored deck, and SHALL be written into an export as `effects[].params`.

The **Effects** block SHALL also offer an **add** control listing every effect the deck can instantiate — the whole corpus plus the deck's `local:` cards — grouped by `kind`, excluding the ids already on the slide, and excluding cards with `persistent: true` at slide scope (they are offered only at deck scope). Adding, removing or editing a parameter of a persistent card SHALL dispose and re-create its single deck-wide instance, never a per-slide copy. Picking one SHALL append it to that scope's list and rebuild the current slide so the addition is visible without a reload; the added effect SHALL gain its declared parameter controls like any composed effect. Adding and removing SHALL NOT mutate the embedded IR, and the resulting list SHALL be what an export pins for that scope.

#### Scenario: Add an effect from the catalogue
- **WHEN** the presenter picks `pixelate` from the add control on a slide that does not list it
- **THEN** the pass is running on the current slide immediately, `pixelate` appears in the checklist with its declared params, `window.__DECK` is unchanged, and an export carries it in that scope's `effects`

#### Scenario: Removing takes effect live
- **WHEN** the presenter unchecks a composed `post` effect
- **THEN** its pass stops running on the current slide immediately — not only at the next reload

#### Scenario: Generated effect parameter control
- **WHEN** slide `geo` composes an effect whose card declares `lift` with `minimum: 0` and `maximum: 4`
- **THEN** the Effects block shows a slider for `lift` bounded `0`–`4`; moving it rebuilds the effect in place, `window.__DECK` is unchanged, and an export carries `effects: [{ id, params: { lift } }]`

#### Scenario: Toggle
- **WHEN** the presenter presses `C`
- **THEN** the panel appears showing `3 / 23` on slide 3; pressing `Escape` hides it

#### Scenario: Autoplay bounds
- **WHEN** the presenter enters `601` or `0.5` in the autoplay field
- **THEN** the control rejects the value and autoplay state is unchanged; `600` is accepted and the deck advances every 600 s; `0` stops autoplay

#### Scenario: Override marker
- **WHEN** slide `geo` has `overrides.slides["geo"].camera.distance` set
- **THEN** in slide scope on `geo` the `camera.distance` control is marked `●` and other controls are not

#### Scenario: Blocks collapse and remember
- **WHEN** the presenter opens **Layout**, closes **Look**, steps to the next slide and reloads the deck
- **THEN** the panel shows **Layout** open and **Look** closed

#### Scenario: Scope-specific blocks
- **WHEN** the panel is in deck scope
- **THEN** the **Layout** block offers `layout`, `rail` and `spacing` and no `diagram.*` or `cardOffset.*` control; in slide scope it offers `layout`, `diagram.*` and `cardOffset.*` and neither `rail` nor `spacing`

#### Scenario: Persistent card not offered per slide
- **WHEN** the presenter opens the add control in slide scope
- **THEN** `frame-chrome` is not listed, and it is listed when the scope is switched to deck

#### Scenario: Editing a persistent card
- **WHEN** the presenter changes a `frame-chrome` parameter at deck scope
- **THEN** exactly one `frame-chrome` instance exists afterwards, outside every slide group, showing the new value
