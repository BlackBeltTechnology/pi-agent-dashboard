## MODIFIED Requirements

### Requirement: Prop search lists candidates for the agent
`props search <keywords...> [--role hero|illustration|ambient]` SHALL query the configured sources (an online CC0/CC-BY model catalogue and a vendored offline CC0 set) and print candidates with: source, id, name, licence, author, triangle count, download size, thumbnail URL. Results SHALL be sorted vendored-first, then by relevance; the command SHALL never download model binaries. The online query SHALL time out after 10 s and fall back to vendored-only results with the skip notice. With `--role ambient` the command SHALL keep only candidates with ≤ 2 000 triangles and SHALL print, for each, a ready-to-paste `overrides.props[]` template with `role: "ambient"`, `count: 12`, `restyle: "palette"`, `size: 0.6` and an existing `anim` value.

#### Scenario: Search returns candidates
- **WHEN** `deck3d props search robot server` runs with the online source configured
- **THEN** a table of at most 20 candidates is printed, each with licence and size, and no `.glb` file is written

#### Scenario: Offline search
- **WHEN** the online source is unreachable or unconfigured
- **THEN** search still returns vendored matches and prints a one-line notice that the online source was skipped

#### Scenario: Ambient filter
- **WHEN** `deck3d props search satellite --role ambient` runs
- **THEN** no printed candidate exceeds 2 000 triangles and each row is followed by an `ambient` template that passes `validate` once `sha256` is filled by `props fetch`

### Requirement: Generate fallback
`props generate --from-image <img> --name <n>` SHALL produce a geometry-only GLB via the configured free image-to-3D service, store it in the vendored-style local cache with `licence: generated`, and print an override entry ready to paste. `props generate --prompt "<text>" --name <n>` SHALL first obtain a reference image from the configured free text-to-image endpoint (`DECK3D_T2I_URL`, with a built-in default), cache it beside the GLB, then continue as `--from-image`. Generated props SHALL default to `restyle: palette` because they carry no textures. Neither path is used by `parse`, `render` or `build`.

#### Scenario: Service unavailable
- **WHEN** the generation service is quota-limited or the optional Python client is missing
- **THEN** the command exits non-zero with the reason and the install/retry hint; nothing else changes

#### Scenario: Prompt path
- **WHEN** `deck3d props generate --prompt "low poly container ship" --name ship` runs with both services reachable
- **THEN** `ship.png` and `ship.glb` exist in the local cache, the printed entry has `licence: generated`, `restyle: palette` and a `sha256`, and `validate` accepts the entry once pasted

#### Scenario: Text-to-image unreachable
- **WHEN** `--prompt` is used and the text-to-image endpoint returns an error
- **THEN** the command exits non-zero naming the endpoint and no GLB is written
