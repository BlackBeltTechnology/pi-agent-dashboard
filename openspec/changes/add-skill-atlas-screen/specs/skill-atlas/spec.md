## Purpose

Shows every skill pi loads in a folder or globally as a typed relation graph (references, same package, shared tool) with cards and a table equivalent, rebuilt automatically when skills change.

## ADDED Requirements

### Requirement: Skill graph is a deterministic function of the resolved skills

The system SHALL derive the skill graph solely from the resolved skill list of the requested scope (id, description, file path, origin, package) and each skill's SKILL.md text. The same inputs SHALL always produce byte-identical output: nodes ordered by id, links ordered by source, target, then type. Disabled skills (pi does not load them) SHALL NOT appear. A skill's id SHALL be its frontmatter name. When two resolved skills share an id, the copy kept SHALL be the project copy, else the package copy, else the global copy; among copies of the same origin, the one with the alphabetically first file path.

#### Scenario: Same inputs give the same graph
- **WHEN** the graph is built twice from identical skill lists and texts given in different input orders
- **THEN** both results SHALL be identical, including the order of nodes and links

#### Scenario: Disabled skill is excluded
- **WHEN** a resolved skill has `enabled: false`
- **THEN** it SHALL NOT appear as a node and SHALL NOT appear in any link

#### Scenario: Project copy wins on duplicate id
- **WHEN** skill `review-code` resolves both from the folder's `.pi/skills` and from a global package
- **THEN** the graph SHALL contain one `review-code` node with origin `project`

### Requirement: `references` links

A directed `references` link from A to B SHALL exist when A's SKILL.md mentions B.
- A hyphenated id SHALL match case-insensitively when bounded by the start or end of the text, or by characters that are not letters, digits, `_` or `-`.
- A single-word id SHALL match only in the forms `/skill:<id>`, `skill: <id>`, or `<id> skill`, matched case-insensitively.
- Ids shorter than 4 characters SHALL never match.
- A skill SHALL NOT reference itself.

#### Scenario: Hyphenated id is referenced
- **WHEN** `plan-proposal`'s SKILL.md contains "then run doubt-driven-review."
- **THEN** a `references` link `plan-proposal → doubt-driven-review` SHALL exist

#### Scenario: Hyphenated id inside a longer token does not match
- **WHEN** a SKILL.md contains `review-code-extra` but not `review-code` on its own
- **THEN** no `references` link to `review-code` SHALL be created from that text

#### Scenario: Hyphenated id matches regardless of case
- **WHEN** a SKILL.md contains "see Doubt-Driven-Review"
- **THEN** a `references` link to `doubt-driven-review` SHALL exist

#### Scenario: Bare single-word id does not match
- **WHEN** a SKILL.md contains the command list "`doctor`, `archive`, `status`" and skill `doctor` exists
- **THEN** no `references` link to `doctor` SHALL be created

#### Scenario: Skill-shaped single-word mention matches
- **WHEN** a SKILL.md contains "use the browser skill"
- **THEN** a `references` link to `browser` SHALL exist

### Requirement: `bundle` links

An undirected `bundle` link SHALL connect every pair of skills shipped by the same named package, but only when that package contributes between 2 and 14 skills (inclusive). Loose (non-package) skills SHALL NOT form bundles.

#### Scenario: Package of 3 skills
- **WHEN** a package contributes skills a, b and c
- **THEN** the links a–b, a–c and b–c of type `bundle` SHALL exist

#### Scenario: Oversized package forms no bundle
- **WHEN** a package contributes 15 skills
- **THEN** none of its skills SHALL have a `bundle` link

### Requirement: `shares-tool` links without a fixed vocabulary

A skill's tool tokens SHALL be the backticked `snake_case` identifiers (at least one underscore, optionally followed by `()` inside the backticks, which is ignored) in its SKILL.md. Token counts SHALL be taken over the skills of the requested scope. An undirected `shares-tool` link SHALL connect every pair of skills sharing a token, but only when that token is mentioned by between 2 and 6 skills (inclusive). No machine-specific tool list SHALL be used. The link SHALL record the token.

#### Scenario: Distinctive shared tool
- **WHEN** exactly three skills mention `` `ctx_execute` ``
- **THEN** each pair of those skills SHALL have a `shares-tool` link whose explanation names `ctx_execute`

#### Scenario: Ubiquitous token is ignored
- **WHEN** seven skills mention `` `memory_search` ``
- **THEN** no `shares-tool` link SHALL be created for that token

#### Scenario: Non-snake-case backtick is not a tool
- **WHEN** two skills mention `` `npm` `` and `` `README.md` ``
- **THEN** no `shares-tool` link SHALL be created for either

### Requirement: Every link explains itself

Every link SHALL carry a human-readable reason: the mention (`references`), the package name (`bundle`), or the shared token (`shares-tool`). The pair plus type SHALL be unique: a pair sharing several tokens SHALL have one `shares-tool` link that lists every shared token. Mutual references SHALL be two directed links.

#### Scenario: Several shared tokens give one link
- **WHEN** skills A and B both mention `` `ctx_execute` `` and `` `ctx_search` ``, and each token is mentioned by at most 6 skills
- **THEN** exactly one `shares-tool` link SHALL connect A and B, and its reason SHALL name both tokens

#### Scenario: Duplicate link is collapsed
- **WHEN** skill A mentions skill B three times
- **THEN** exactly one `references` link A → B SHALL exist

### Requirement: Skill graph endpoint

The server SHALL expose `GET /api/plugins/skill-atlas/graph` behind the same network guard as other resource routes.
- `scope=project` with an absolute `cwd` SHALL return the effective set pi loads in that folder: project, global and package skills.
- `scope=global` SHALL return global and global-package skills only.

The response SHALL carry the fields `scope`, `cwd` (project only), `fingerprint`, `builtAt`, `degraded`, `skills`, `links` and `warnings`. Each skill SHALL be `{ id, description, filePath, origin, pkg?, degree }`. The response SHALL NOT contain SKILL.md bodies. A project request without `cwd`, or with a relative `cwd`, SHALL return 400. A host without the resource accessor SHALL return 501.

#### Scenario: Project scope includes global skills
- **WHEN** the client requests `scope=project&cwd=/repo` and `/repo/.pi/skills` holds 14 skills while 77 are global or package skills
- **THEN** the response SHALL contain 91 skills, the 14 marked origin `project`

#### Scenario: Global scope excludes project skills
- **WHEN** the client requests `scope=global`
- **THEN** no returned skill SHALL have origin `project`

#### Scenario: Missing cwd
- **WHEN** the client requests `scope=project` without `cwd`
- **THEN** the server SHALL respond 400

#### Scenario: Bodies never leave the server
- **WHEN** any graph response is returned
- **THEN** no field SHALL contain SKILL.md body text beyond the frontmatter description

#### Scenario: Degraded scan is surfaced
- **WHEN** the underlying resource scan fell back to a directory walk
- **THEN** the response SHALL have `degraded: true`

### Requirement: Graph stays fresh without manual regeneration

Every graph request SHALL check a fingerprint of the skill set: each skill's id, description, origin and package, plus its file's path, modification time, change time and size. When the fingerprint is unchanged, the server SHALL return the previous graph without re-reading any SKILL.md. Otherwise it SHALL rebuild. An edited SKILL.md body SHALL therefore be reflected on the next request even when no directory watcher fired. An added or removed skill SHALL be reflected once the resource rescan completes, and the live update below delivers it to open atlases. Only the first 256 KiB of a SKILL.md SHALL be considered. A longer file SHALL produce a warning naming the skill, and mentions beyond the limit SHALL NOT create links. A skill file that cannot be read SHALL NOT fail the request: the skill remains with an empty body, and a warning names it. A skill file that disappears between the scan and the check SHALL be left out, and a warning names it. A content edit that keeps the size and modification time SHALL still be detected when the file's change time moved.

#### Scenario: Body edit is picked up on next request
- **WHEN** a user edits an existing `.pi/skills/x/SKILL.md` to mention `review-code`, then the atlas is requested
- **THEN** the response SHALL contain the link `x → review-code` and a new `fingerprint`

#### Scenario: Unchanged state reuses the graph
- **WHEN** two requests arrive with no skill file changed in between
- **THEN** the second SHALL return the same `fingerprint` and SHALL NOT read any SKILL.md

#### Scenario: File vanishes between scan and check
- **WHEN** a resolved SKILL.md is deleted after the resource scan but before the fingerprint check
- **THEN** the response SHALL succeed without that skill and list a warning naming it

#### Scenario: Unreadable file
- **WHEN** one resolved SKILL.md becomes unreadable
- **THEN** the response SHALL succeed, include that skill, and list a warning naming it

### Requirement: Open atlases update live

When skills are added, removed or edited and a watched resource directory changes or a session reports its command list (including after a reload), the server SHALL re-check the affected atlases' fingerprints. When an atlas's graph differs from the graph last announced for it, the server SHALL notify connected browsers with the scope and folder. The comparison SHALL use a rescan that started after the trigger, so an edit made during an earlier scan is not missed. A session's command list SHALL also re-check the global atlas. An open atlas SHALL refetch, keep showing the previous graph meanwhile, and show "Updating…" until the new graph arrives. Bursts SHALL be coalesced. No notification SHALL be sent when the graph is unchanged, even if file metadata changed.

#### Scenario: New skill appears without reload of the page
- **WHEN** the project atlas for `/repo` is open and a skill folder is added under `/repo/.pi/skills`
- **THEN** the atlas SHALL show the new skill without the user reloading the page

#### Scenario: Reload with no change is silent
- **WHEN** a session in `/repo` reloads and no skill file changed
- **THEN** no change notification SHALL be sent

#### Scenario: Metadata-only change is silent
- **WHEN** a SKILL.md is touched (`touch`/`chmod`) without changing its content
- **THEN** no change notification SHALL be sent

#### Scenario: Request racing the update still notifies
- **WHEN** a skill is edited, and a graph request rebuilds the atlas before the live-update check runs
- **THEN** open atlases SHALL still receive one change notification

#### Scenario: Stale view kept while updating
- **WHEN** a change notification arrives
- **THEN** the current graph SHALL stay visible with an "Updating…" status (shape + text) until the refetch completes

### Requirement: Atlas entry points

The project atlas SHALL be reachable from three places:
- a "Skill Atlas" item in the folder actions menu (group `open`);
- the Folder Skills page;
- the URL `/folder/<encoded cwd>/atlas`, whose Back action returns to the folder.

The global atlas SHALL be reachable from three places:
- the URL `/atlas`;
- the Global Skills settings page;
- a "Skill Atlas" entry in the Resources group of the settings navigation.

Disabling the plugin SHALL remove every entry point after the restart that plugin toggles require.

#### Scenario: Folder menu opens project atlas
- **WHEN** the user picks "Skill Atlas" in the actions menu of folder `/repo`
- **THEN** the project atlas for `/repo` SHALL open in the content area beside the sidebar

#### Scenario: Plugin disabled
- **WHEN** the skill-atlas plugin is disabled and the server restarted
- **THEN** no folder menu item, Skills-page section, settings entry or atlas route SHALL be present

### Requirement: Skills-page summary section

On the Folder and Global Skills pages, a compact section above the unchanged skill grid SHALL show:
- the skill and link counts;
- one count per relation type, each paired with its line glyph and name;
- up to five most-connected skills (each opens the atlas focused on that skill);
- an "Open atlas" action.

When the scope has no skills, the section SHALL render nothing. A degraded scan SHALL show a warning line. A failed request SHALL show an error with Retry.

#### Scenario: Most-connected chip opens focus
- **WHEN** the user activates the `context-mode` chip
- **THEN** the atlas SHALL open with `context-mode` selected and 1-hop focus

#### Scenario: Empty scope renders nothing
- **WHEN** the scope resolves zero skills
- **THEN** no atlas section SHALL be rendered on the Skills page

### Requirement: Atlas views

The atlas SHALL offer Cards, Graph and Links views (keyboard-operable tabs). Search, relation-type toggles and origin toggles (Project, Global, Package) SHALL apply to all three. Relation type SHALL be conveyed by colour, line style and name together, and origin by node shape. Colour SHALL never be the only cue.

- **Selection.** Selecting a skill in any view SHALL open a detail panel showing:
  - its description, path, origin and package (if its SKILL.md cannot be opened, an inline error SHALL be shown);
  - its neighbours grouped by relation, each with the reason;
  - a focus control (All, 1 hop, 2 hops);
  - an action to open its SKILL.md.

  A mutual reference SHALL appear as one neighbour entry marked as bidirectional.
- **Search and focus behaviour.**
  - In the graph, focus SHALL re-fit the view to the focused neighbourhood, and non-matching nodes SHALL be dimmed.
  - In Cards and Links, non-matching items SHALL be hidden, and a status line "Showing N of M" with a Clear action SHALL be shown.
- **Scale limit.** Above 300 skills the Graph view SHALL be disabled with a stated reason, while Cards and Links keep working.
- **Determinism.** The graph layout SHALL be identical for an identical graph at the same viewport size.

#### Scenario: Links table is the graph's text equivalent
- **WHEN** the user switches to Links with the same filters as the graph
- **THEN** the table SHALL list exactly the links the graph draws, with source, relation, target and reason

#### Scenario: Graph keyboard access
- **WHEN** the graph has focus and the user presses Right Arrow then Enter
- **THEN** the most-connected skill SHALL be selected and its details shown

#### Scenario: Mutual reference shown once
- **WHEN** `plan-proposal` and `ship-it` reference each other and `plan-proposal` is selected
- **THEN** the detail panel SHALL list `ship-it` once, marked bidirectional

#### Scenario: Focus filters cards by hiding
- **WHEN** 1-hop focus is active on a skill with 5 neighbours and the Cards view is shown
- **THEN** exactly 6 cards SHALL be visible and the status line SHALL read "Showing 6 of <total>"

#### Scenario: Large set disables graph
- **WHEN** the scope resolves 312 skills
- **THEN** the Graph tab SHALL be disabled and an explanation SHALL be shown, and Cards SHALL list all 312

#### Scenario: Same graph, same picture
- **WHEN** the atlas is opened twice for an unchanged graph at the same viewport size
- **THEN** every node SHALL be drawn at the same position

### Requirement: Untrusted skill text is rendered safely

Skill names, descriptions, paths and link reasons SHALL be rendered as text, never interpreted as HTML. The SKILL.md opened from the detail panel SHALL be read only through the existing restricted resource-file read path.

#### Scenario: Markup in description
- **WHEN** a skill's description is `<img src=x onerror=alert(1)>`
- **THEN** the atlas SHALL display that string literally and execute nothing

### Requirement: Atlas performance budget

The atlas SHALL meet these budgets on the reference developer machine:
- a graph request whose skill set is unchanged, at 100 skills: server handling time under 100 ms at p95;
- a full rebuild at 300 skills, including bodies at the 256 KiB limit: under 500 ms;
- a skill folder added while the atlas is open: the atlas shows the new skill within 5 s;
- client layout plus first graph render at 300 nodes: under 500 ms.

#### Scenario: Unchanged request is fast
- **WHEN** 200 graph requests are made against an unchanged 100-skill set
- **THEN** the p95 server handling time SHALL be under 100 ms

#### Scenario: Large rebuild is bounded
- **WHEN** the graph is rebuilt for 300 skills whose SKILL.md files are 256 KiB each
- **THEN** the rebuild SHALL complete in under 500 ms

#### Scenario: Live update is prompt
- **WHEN** a skill folder is added under the folder's `.pi/skills` while its atlas is open
- **THEN** the new skill SHALL be visible in the atlas within 5 s

#### Scenario: Large graph renders promptly
- **WHEN** the Graph view first renders a 300-node graph
- **THEN** layout and render together SHALL take under 500 ms
