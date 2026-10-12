## ADDED Requirements

### Requirement: Mode `new` scaffolds an embedded app with a project scope
In mode `new`, the single up-front batch SHALL ask for an embedded-app scope: `none`, `global`, `project-type` or `project-specific`.

**Batch questions per scope**
- `project-type`: the type and at least one marker pattern.
- `project-specific`: the project id and an optional absolute folder path to write that id into. An empty path means no write.

Inputs SHALL be validated against the rules the manifest validator and the declared identity file apply. On a violation the skill SHALL report every violation and stop without writing anything. It SHALL NOT add any prompt beyond the existing final summary confirm. For `project-specific` without a folder path, the final summary SHALL warn that the app matches no folder until the id is declared in a folder.

**Generated app.** For any scope other than `none`, the scaffold SHALL produce, following the `demo-plugin` app pattern:
- a `defineDashboardApp` app;
- a lazily loaded route module that renders `<EmbeddedApp>`;
- a `shell-overlay-route` claim with `presentation: "content"`.

**Claims per scope**
- `global` SHALL use a `depth: 1` claim and no folder entry.
- `project-type` and `project-specific` SHALL use a `depth: 2` claim under `/folder/:encodedCwd`.
- They SHALL also add a state-only `sidebar-folder-section` entry whose `predicate` is an exported `folderHasProjectType(<type>)` or `folderHasProjectId(<id>)`.
- The route SHALL pass the matching `projectScope` to `<EmbeddedApp>`, SHALL NOT pass a `standaloneUrl`, and SHALL NOT generate a standalone entry.
- `project-type` SHALL also write the manifest `projectTypes` entry.

**Writing the id (`project-specific` with a folder path).** Only after the final summary confirm, the skill SHALL write the id into `<folder>/.pi/dashboard/project.json`:
- It SHALL create the file when absent, with `schemaVersion: 1`.
- Otherwise it SHALL set `id`, add `schemaVersion: 1` only when `schemaVersion` is absent, and preserve every other field. The written file SHALL be accepted by the identity-file reader.
- It SHALL write atomically, via a temporary file in the same directory and a rename.
- It SHALL refuse the write, leave the file unchanged and report why when:
  - the file, `.pi` or `.pi/dashboard` is a symbolic link;
  - the file is not a regular file, is larger than 64 KiB, or is not a JSON object;
  - the file carries a `schemaVersion` that is present and not `1`;
  - the file already declares a different `id`.

#### Scenario: Project-type app scaffold
- **WHEN** the user picks scope `project-type`, type `judo`, marker `model/*.judo`
- **THEN** the generated package declares `projectTypes: [{ "type": "judo", "markers": ["model/*.judo"] }]`, a state-only folder-section claim gated by an exported `folderHasProjectType("judo")` predicate, and a lazy route rendering `<EmbeddedApp projectScope={{ type: "judo" }}>` with no standalone entry

#### Scenario: Project-specific id merged after confirm
- **GIVEN** folder `acme-erp` has `.pi/dashboard/project.json` `{ "schemaVersion": 1, "type": "judo", "owner": "x" }`
- **WHEN** the user picks scope `project-specific`, id `acme-erp`, folder `acme-erp`, and accepts the final summary
- **THEN** the file becomes `{ "schemaVersion": 1, "type": "judo", "owner": "x", "id": "acme-erp" }`

#### Scenario: Existing different id is never replaced
- **GIVEN** folder `acme-erp` already declares `"id": "legacy"`
- **WHEN** the user asks to write id `acme-erp` into it
- **THEN** the plugin package is scaffolded, the file is left unchanged, and the skill reports that the existing id `legacy` must be changed by hand
