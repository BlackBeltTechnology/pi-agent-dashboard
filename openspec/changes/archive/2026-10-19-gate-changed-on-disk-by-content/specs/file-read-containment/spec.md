## ADDED Requirements

### Requirement: The file digest route is contained by the read site's gate

`GET /api/file/digest` SHALL be contained by the same gate as the `GET /api/file` read
site: the same layered check, the same containment anchors (`cwd` plus
`homePiAnchor()`), the same rejection string and remedy fields, and the same
grant-only verified open. It SHALL be implemented by calling the read site's gate, not
a copy of it, so the two cannot drift. It is a second caller of the read site, not an
additional containment site: the ten-site enumeration and every per-site anchor set are
unchanged.

#### Scenario: Digest and read refuse identically
- **GIVEN** any path and cwd
- **WHEN** `GET /api/file` and `GET /api/file/digest` are requested for it without a grant prompt
- **THEN** both are admitted, or both are refused with the same status, error string and remedy fields

#### Scenario: Grant-admitted digest uses the verified open
- **GIVEN** a path outside the anchors admitted only by a grant
- **WHEN** its digest is requested
- **THEN** the file is opened through the handle-verified open, and a symlink or FIFO swapped in is refused
