## MODIFIED Requirements

### Requirement: Persona editor

The app SHALL let a user create, edit and delete their own personas and fork any visible persona, and SHALL let an admin do the same for shared personas. The editor SHALL offer a project assignment list (own workspace plus the projects the author may assign, at least one required, the own workspace preselected for a new persona and the selected project added when the editor is opened from an empty project), SHALL show server validation errors next to the field, SHALL offer `full` tools only for shared personas, SHALL offer as skills only the catalog skills allowed for every selected target (and, on a private persona, for the user), removing a ticked skill that a target change makes ineligible and saying so, SHALL show admins a hint that links to the Skills panel when the catalog is empty, and SHALL confirm deletion with a dialog that states existing conversations are kept.

#### Scenario: Validation error shown
- **WHEN** the user saves a persona with a 61-character name
- **THEN** the name field shows the error and nothing is saved

#### Scenario: At least one target
- **WHEN** the user unticks every entry in the project list and saves
- **THEN** the field shows an error and nothing is saved

#### Scenario: Skills follow the targets
- **WHEN** the user ticks `review` (allowed in `billing` only) and then adds `crm` to the project list
- **THEN** `review` is unticked and disabled, and a note says it is not allowed in `crm`

#### Scenario: Empty catalog hint
- **WHEN** the catalog is empty and an admin opens the editor
- **THEN** the Skills field shows a hint with a link to the Skills panel, and a non-admin sees no Skills field

## ADDED Requirements

### Requirement: Admin Skills panel

The app SHALL show admins (the operator in single-user mode) a Skills panel. The panel lists every catalog entry with its name, source (`config` or `managed`), users and targets. It lets the admin add an entry by picking from the available skills or entering an absolute path, set its users (`everyone` or a list of principals, hidden in single-user mode) and targets (`all` or a list of projects and the own workspace), edit or remove managed entries, and see config entries read-only. Before a save that changes or removes an entry, the panel SHALL show the server's impact preview (sessions to end, personas that become blocked) and, when sessions would end, SHALL confirm before saving. Entries the server reports as invalid SHALL show the reason, including "name does not match the skill". Non-admins SHALL NOT see the panel.

#### Scenario: Admin grants a skill to one project
- **WHEN** an admin picks `review` from the available skills, sets targets to `billing` and users to everyone, and saves
- **THEN** the entry is listed as `managed`, and an editor of a persona assigned only to `billing` offers `review`

#### Scenario: Config entry read-only
- **WHEN** an admin opens an entry that comes from config
- **THEN** its fields are read-only and there is no remove action

#### Scenario: Removal confirms session end
- **WHEN** an admin removes `review` while two conversations using it are live
- **THEN** a dialog says 2 sessions will be ended, and confirming removes the entry

### Requirement: Skill availability feedback

The app SHALL make skill state visible before and during a conversation:
- An agent card SHALL show a chip with the number of `effectiveSkills`, naming them in its tooltip.
- A card with a `skillBlock` SHALL show a warning that is specific to the reason and SHALL NOT offer to start a conversation. Admins get a fix action: "Fix skill", which opens the skill's Skills-panel entry, for `invalid` and `missing`; "Fix persona", which opens the editor, for `targets` and `users`. Non-admins get "Ask your administrator".
- An open conversation that answers `409 skill_not_allowed` SHALL show the same reason-specific error above the transcript, keep the history readable and disable the composer.
- The conversation header SHALL list the effective skills.
- Before sending, the composer SHALL refuse input that the shared `parseSkillCommand` rule recognises as `/skill:<name>` when `<name>` is not an effective skill. It SHALL keep the text, mark the field invalid, and say which skills are available. The server-side guard stays the authority.

#### Scenario: Reason-specific card
- **WHEN** an admin views a card whose `skillBlock` is `{ skill: "legacy-lint", reason: "invalid" }`
- **THEN** the card says the skill's path is invalid, offers "Fix skill" leading to `legacy-lint` in the Skills panel, and has no chat button

#### Scenario: Composer refuses an unavailable skill
- **WHEN** alice types `/skill:memory-x summarise` to an agent whose effective skills are `review` and `openspec-propose` and presses Enter
- **THEN** nothing is sent, the text stays in the composer, the field is marked invalid, and the message lists `/skill:review, /skill:openspec-propose`

