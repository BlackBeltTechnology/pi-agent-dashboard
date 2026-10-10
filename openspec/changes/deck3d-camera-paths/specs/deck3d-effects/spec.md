## ADDED Requirements

### Requirement: Transition cards for camera motions
The corpus SHALL contain `transition`-kind cards for `swing`, `revolve`, `crane`, `bank` and `path` in addition to
`dolly`, `fade`, `iris`, `flythrough`; each card only registers its id (the motion lives in the runtime). The set
of corpus `transition` card ids plus `cut` SHALL equal the runtime's transition id list, and the HUD transition
selector SHALL offer exactly that list. The motion scale SHALL be the IR knob `transitionAmount` (deck or slide,
0–2, default 1). The reference showroom deck SHALL enter the slide presenting each transition card with that
transition (`path` with a demo `cameraPath`).

#### Scenario: HUD lists every transition card
- **WHEN** the corpus contains the nine transition cards
- **THEN** the HUD transition selector offers exactly those nine ids plus `cut`

#### Scenario: Amount scales the motion
- **WHEN** a `crane` move with `transitionAmount: 2` is sampled at its mid-point
- **THEN** its rise above the straight line is twice that of `transitionAmount: 1`
