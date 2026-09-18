## Purpose

Illustrate slides and diagram nodes with reusable, content-related 3D models: an agent searches and picks a model, the deterministic engine fetches, pins, normalises, restyles, animates and embeds it.

## ADDED Requirements

### Requirement: Prop search lists candidates for the agent
`props search <keywords...>` SHALL query the configured sources (an online CC0/CC-BY model catalogue and a vendored offline CC0 set) and print candidates with: source, id, name, licence, author, triangle count, download size, thumbnail URL. Results SHALL be sorted vendored-first, then by relevance; the command SHALL never download model binaries.

#### Scenario: Search returns candidates
- **WHEN** `deck3d props search robot server` runs with the online source configured
- **THEN** a table of at most 20 candidates is printed, each with licence and size, and no `.glb` file is written

#### Scenario: Offline search
- **WHEN** the online source is unreachable or unconfigured
- **THEN** search still returns vendored matches and prints a one-line notice that the online source was skipped

### Requirement: Prop selection lives in overrides
A prop SHALL be attached by writing an entry under `overrides.props[]` with: `source`, `id`, `licence`, `author`, `sha256`, `slide`, `role` (`hero` | `illustration` | `ambient` | `node:<nodeId>`), `size`, `restyle` (`palette` | `original`), `anim` (`none` | `idle-bob` | `spin` | `orbit` | `float-pulse`). `validate` SHALL reject unknown roles, a `node:` role naming a node not in that slide's diagram, and a missing `sha256`.

#### Scenario: Node replacement
- **WHEN** a prop has `role: node:LLM` on a slide whose flowchart has node `LLM`
- **THEN** the rendered slide shows the model in place of the node's primitive, with the node's label and edges attached unchanged

#### Scenario: Dangling node role
- **WHEN** a prop has `role: node:Foo` and no node `Foo` exists on that slide
- **THEN** `validate` fails naming the prop and the missing node id

### Requirement: Fetch is hash-pinned and bounded
`props fetch` SHALL download every prop referenced in overrides into a local cache, compute its sha256, and write it into the override when absent or fail when it differs. Downloads SHALL be limited to glTF/GLB, capped in size (default 8 MB, overridable), and cache file names SHALL derive from source+id only.

#### Scenario: Hash mismatch
- **WHEN** the cached file's sha256 differs from the override's `sha256`
- **THEN** `fetch` and `render` exit non-zero naming the prop; no HTML is written

#### Scenario: Oversized model
- **WHEN** a candidate exceeds the size cap
- **THEN** `fetch` refuses it with the actual size and the cap, exit non-zero

### Requirement: Render embeds and normalises props
`render` SHALL embed each prop's binary into the single HTML file, scale it so its longest bounding-box side equals `size`, ground it on the slide floor, orient it toward the camera, and apply the animation preset synchronised to slide entry. With `restyle: palette` every material SHALL be replaced by the deck's material family in palette colours; with `original` the model's own materials SHALL be kept.

#### Scenario: Two props, same visual language
- **WHEN** two props from different authors are placed with `restyle: palette`
- **THEN** both render with the deck's material and palette, and their longest sides match their `size` values

#### Scenario: Offline output with props
- **WHEN** a deck with props is opened from disk with networking disabled
- **THEN** every prop renders with no failed resource loads

### Requirement: Generate fallback
`props generate --from-image <img> --name <n>` SHALL produce a geometry-only GLB via the configured free image-to-3D service, store it in the vendored-style local cache with `licence: generated`, and print an override entry ready to paste. Generated props SHALL default to `restyle: palette` because they carry no textures.

#### Scenario: Service unavailable
- **WHEN** the generation service is quota-limited or the optional Python client is missing
- **THEN** the command exits non-zero with the reason and the install/retry hint; nothing else changes

### Requirement: Licence credits are automatic
When any embedded prop has an attribution-requiring licence, the deck SHALL end with a generated credits slide listing name, author, source and licence per prop. CC0 and generated props SHALL not require a credits slide.

#### Scenario: CC-BY prop present
- **WHEN** one prop has `licence: CC-BY-4.0`
- **THEN** the rendered deck has a final "Credits" slide naming it and its author

### Requirement: Prop budget warning
`validate` SHALL warn when total embedded prop size exceeds a default budget (5 props or 10 MB), stating the totals; it SHALL not fail.

#### Scenario: Over budget
- **WHEN** six props are attached
- **THEN** `validate` exits 0 with a warning listing count and total bytes
