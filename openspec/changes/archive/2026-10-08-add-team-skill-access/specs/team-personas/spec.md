## MODIFIED Requirements

### Requirement: Skills come from an admin catalog

A persona's `skills` SHALL be names of entries in the team skill catalog. A write naming an unknown skill SHALL be rejected with `400 invalid_persona`. Each listed skill SHALL be allowed, by its catalog entry's `targets`, for every target in the persona's `projects`. For a private persona each listed skill SHALL also be allowed, by its entry's `users`, for the owner. In single-user mode `users` is ignored. A write breaking either rule SHALL be rejected with `400 invalid_persona` and `fields.skills = "skill_not_allowed"`, and SHALL NOT change the store. Skill paths SHALL be resolved server-side from the catalog and SHALL never be taken from a persona.

#### Scenario: Unknown skill refused
- **WHEN** a persona lists skill `/tmp/evil` or a name not in the catalog
- **THEN** the response is `400 invalid_persona`

#### Scenario: Skill not allowed in an assigned target
- **WHEN** an admin saves `shared:backend` with `projects: ["billing", "crm"]` and `skills: ["review"]`, and `review` has `targets: ["billing"]`
- **THEN** the response is `400 invalid_persona` with `fields.skills = "skill_not_allowed"` and nothing is written

#### Scenario: Private persona skill not allowed for the owner
- **WHEN** alice saves a private persona with `skills: ["review"]`, and `review` lists only bob in `users` in multi-user mode
- **THEN** the response is `400 invalid_persona` and nothing is written

#### Scenario: Fork keeps only allowed skills
- **WHEN** alice forks a shared persona whose skills include one that is not allowed for her or for the fork's projects
- **THEN** the fork omits that skill
