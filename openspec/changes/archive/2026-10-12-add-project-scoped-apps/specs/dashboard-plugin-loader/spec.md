## ADDED Requirements

### Requirement: Manifest `projectTypes` marker rules are validated
A plugin manifest MAY declare `projectTypes: Array<{ type: string; markers: string[] }>` with at most 8 entries.

**Fields**
- `type` SHALL match `^[a-z][a-z0-9-]{0,63}$`.
- `markers` SHALL hold 1 to 16 patterns.

**Pattern grammar.** A marker pattern SHALL be 1 to 3 segments joined by `/`. Each segment SHALL be non-empty, and SHALL be either a literal name or a name containing `*` wildcards. The last segment SHALL contain at least one character other than `*`. A pattern SHALL NOT:
- start or end with `/`;
- contain `\`;
- contain a `.`, `..`, `.git` or `node_modules` segment;
- contain `**`;
- contain any of `?[]{}!`.

**Errors.** A violation SHALL be a fatal manifest error naming the plugin and the offending entry.

**Compatibility and lifetime**
- A manifest without `projectTypes` SHALL validate exactly as before.
- A valid `projectTypes` SHALL be preserved in the validated manifest that discovery returns.
- Rules from a plugin SHALL take part in project detection only while that plugin is enabled.

#### Scenario: Valid rules survive discovery
- **WHEN** a manifest declares `projectTypes: [{ "type": "judo", "markers": ["model/*.judo", "judo.yaml"] }]`
- **THEN** the plugin loads and its discovered manifest carries the same `projectTypes`

#### Scenario: Escaping pattern is fatal
- **WHEN** a manifest declares a marker `../secrets/*.key`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern

#### Scenario: Recursive or wildcard-only pattern is fatal
- **WHEN** a manifest declares a marker `**/pom.xml` or `src/*`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern

#### Scenario: Excluded directory is fatal
- **WHEN** a manifest declares a marker `node_modules/judo/package.json`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern
