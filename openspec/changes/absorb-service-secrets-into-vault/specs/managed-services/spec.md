## MODIFIED Requirements

### Requirement: Adding, updating and removing services are explicit actions
`POST /api/services` with `dryRun: true` SHALL return a review: the image digest
or runner recipe, ports, volumes, secret names and `templateHash`. The same call
with `dryRun: false` SHALL write the entry. `pi-dashboard service add <id>`
SHALL show that review and require confirmation unless `--yes` is given. When an
offer's `templateHash` differs from the entry's `origin.templateHash`, the
service SHALL report `updateAvailable` with a diff `[{ path, from, to }]`, and
SHALL apply it only on an explicit update request (`update: true` /
`service add --update <id>`). `DELETE /api/services/:id`
(`service remove <id>`) SHALL stop the service if it is owned, remove its
container or instance files, its `services-run/<id>/` directory and its stored
secrets, except secrets another service definition still references through
`store:` (see `service-secrets`), and its vault service grants (see `credential-vault`). Named volumes SHALL be retained unless purging is explicitly requested
(`--purge-data` / `purgeData: true`). The confirmation skipped by `--yes` SHALL
NOT cover any package prefetch.

#### Scenario: Plugin upgrade does not rewrite the entry
- **WHEN** a package upgrade changes the `docling` offer's image digest
- **THEN** the `docling` entry in `services.json` SHALL be unchanged
- **AND** `GET /api/services` SHALL report `updateAvailable: true` with the digest diff

#### Scenario: Dry-run writes nothing
- **WHEN** `POST /api/services` is called with `dryRun: true`
- **THEN** `services.json` SHALL be unchanged

#### Scenario: Removal keeps a secret another definition references
- **WHEN** `service remove neo4j` runs while service `app` references `store:neo4j/password`
- **THEN** `neo4j/password` SHALL remain stored, and the other `neo4j` secrets SHALL be removed
