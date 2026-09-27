## MODIFIED Requirements

### Requirement: EML sanitizer loads lazily so a broken jsdom cannot block server boot

The server-side HTML sanitizer (`isomorphic-dompurify`) SHALL be loaded lazily at first sanitize
through the shared `loadPurify()` helper, NOT via a static top-level import (it constructs a
`jsdom` window on first evaluation). This applies to every server-side sanitizer consumer: EML
bodies, docx HTML and diagram (Kroki) SVGs. `loadPurify()` SHALL load the package with native
`require` (`createRequire`), NOT dynamic `import()`: under the server's `node --import
jiti-register` loader a dynamic import routes jsdom's CommonJS through jiti and breaks its
`interfaces.js` ↔ `create-element.js` require cycle. It SHALL NOT cache an instance whose
`sanitize` is not a function, so a failed first load is retried on the next request. A failure to initialize the sanitizer (e.g. a corrupt/torn `jsdom`
install) SHALL therefore surface only on an EML preview request, and SHALL NOT prevent the
server from starting or registering routes.

#### Scenario: Importing the EML module does not construct jsdom
- **WHEN** the EML parse module is imported at server startup
- **THEN** no `jsdom` window is constructed and the server boots and registers routes normally

#### Scenario: A broken sanitizer degrades to a failed request, not a dead server
- **GIVEN** a `node_modules/jsdom` that throws on construction
- **WHEN** the client requests `/api/file/eml` for an `.eml` with an HTML body
- **THEN** that single request fails with an HTTP error `{ success: false, error: … }`
- **AND** the server process stays up and other routes continue to respond

#### Scenario: Sanitizer works under the server's jiti loader
- **GIVEN** a process started with `node --import jiti-register` (as the dashboard server is)
- **WHEN** `loadPurify()` sanitizes `<svg><script>…</script><g/></svg>`
- **THEN** it returns `<svg><g></g></svg>` (jsdom initialized correctly, script stripped)
