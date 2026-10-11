## ADDED Requirements

### Requirement: Transition kinds and camera paths in the IR
The IR SHALL accept `transition` (deck default and per-slide override) only from the closed set of corpus
`transition` ids: `dolly`, `swing`, `revolve`, `crane`, `bank`, `flythrough`, `fade`, `iris`, `cut`, `path`;
`validate` SHALL reject any other value naming its path. The deck SHALL accept `transitionCycle: string[]` (same
id set, at least one entry, deck-level only) and `transitionAmount` (number 0–2, deck or slide); a slide without its own `transition` SHALL resolve to
`transitionCycle[slideIndex % length]`, else to `defaults.transition`, and the resolved id SHALL be recorded in
the derived slide config. `overrides.slides["<id>"].cameraPath` SHALL be `{ keys: Key[], ease?: "inOut" | "in" |
"out" | "linear" }` with 1–8 keys, each `{ t: number, offset?: [r, u, f], look?: number, roll?: number, fov?:
number }`; `t` SHALL be strictly increasing within the open interval (0, 1), offsets are fractions of the travel
length, `look` in [0, 1], `roll` in [-45, 45] degrees, `fov` in [20, 90] degrees. `cameraPath` on a slide whose
resolved transition is not `path` SHALL fail `validate`, and `transition: "path"` without `cameraPath` SHALL fail
`validate`.

#### Scenario: Unknown transition rejected
- **WHEN** a deck sets `overrides.slides["intro"].transition` to `"spin"`
- **THEN** `validate` fails naming `overrides.slides.intro.transition`

#### Scenario: Cycle fills unspecified slides
- **WHEN** `transitionCycle` is `["dolly", "revolve", "crane"]` and only slide 4 sets `transition: "cut"`
- **THEN** slides 0–3 and 5 resolve to `dolly`, `revolve`, `crane`, `dolly`, `crane` in order and slide 4 to `cut`

#### Scenario: Path keys must be ordered
- **WHEN** a `cameraPath` has keys with `t` values `0.6` then `0.4`
- **THEN** `validate` fails naming the second key

#### Scenario: Path needs the path transition
- **WHEN** a slide has `cameraPath` but its resolved transition is `dolly`
- **THEN** `validate` fails naming `overrides.slides.<id>.cameraPath`
