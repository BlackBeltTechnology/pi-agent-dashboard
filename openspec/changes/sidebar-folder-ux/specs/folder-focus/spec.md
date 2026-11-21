## MODIFIED Requirements

### Requirement: Render-mode resolution

In accordion mode each folder SHALL render in one of four modes. "Has attention" is true only when `folderAttentionPeek` is on AND at least one of the folder's visible sessions needs attention (see `session-filtering`).

| focused | collapsed | pinned open | has attention | mode |
|---|---|---|---|---|
| any | any | yes | any | full |
| yes | no | no | any | full |
| yes | yes | no | any | collapsed |
| no | any | no | yes | compact with attention |
| no | any | no | no | compact empty |

`full` and `collapsed` SHALL render as an expanded or collapsed folder does in classic mode. Both compact modes SHALL render the condensed folder header (as a collapsed folder) followed by the compact body defined by `session-filtering`, EXCEPT that the Group-by chip row SHALL NOT render in a compact mode, so a compact-empty folder is a single header row. While a session search or workspace filter is active, every folder with matches SHALL render `full`.

#### Scenario: Pinned open wins
- **GIVEN** `/foo` pinned open, unfocused and collapsed
- **THEN** `/foo` SHALL render `full`

#### Scenario: Unfocused without attention
- **GIVEN** `/foo` unfocused, not pinned open, no session needing attention
- **THEN** `/foo` SHALL render the condensed header and the compact-empty body

#### Scenario: Search forces full
- **GIVEN** an active session search matching a session in unfocused `/foo`
- **THEN** `/foo` SHALL render `full`

#### Scenario: Compact folder has no Group-by row
- **GIVEN** unfocused `/foo` in a compact mode with a non-default group-by setting
- **THEN** no Group-by chip row SHALL render for `/foo`
- **AND** a classic collapsed folder with the same setting SHALL still render it
