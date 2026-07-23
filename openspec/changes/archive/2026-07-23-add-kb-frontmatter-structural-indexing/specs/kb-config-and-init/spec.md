## ADDED Requirements

### Requirement: Frontmatter facet configuration
Configuration SHALL define the frontmatter structural-indexing behavior: the list
of searchable keys, the whitelist of facet keys with an optional declared type
(string default, or numeric/date), and optional per-doc-type overrides. Defaults
SHALL keep behavior a superset of today (existing `tags → has_tag` unchanged) and
SHALL be validated like other config groups.

#### Scenario: Default searchable and facet keys
- **WHEN** no frontmatter config is provided
- **THEN** the searchable keys default to `title, description, aliases, keywords`
  and `tags` is faceted, with existing tag→graph behavior preserved

#### Scenario: Declared facet type
- **WHEN** a facet key is configured with type `date` or `number`
- **THEN** matching values are coerced into `value_date`/`value_num` for range use,
  and all other keys remain string-typed

#### Scenario: Facet-config hash participates in the reindex gate
- **WHEN** the frontmatter facet configuration changes
- **THEN** the stored facet-config hash differs and a full reindex is forced so
  property rows reflect the new configuration

#### Scenario: Invalid frontmatter config rejected
- **WHEN** the frontmatter config declares an unknown type or a malformed key list
- **THEN** configuration validation fails with a descriptive error
