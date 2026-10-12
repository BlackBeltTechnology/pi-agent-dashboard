## ADDED Requirements

### Requirement: EML sanitizer loads lazily via native require so a broken jsdom cannot block server boot

The server-side HTML sanitizer (`isomorphic-dompurify`) SHALL be loaded lazily at first sanitize
through the shared `loadPurify()` helper, NOT via a static top-level import (it constructs a
`jsdom` window on first evaluation). This applies to every server-side sanitizer consumer: EML
bodies, docx HTML and diagram (Kroki) SVGs. `loadPurify()` SHALL load the package with native
`require` (`createRequire`), NOT dynamic `import()`, so jsdom's CommonJS graph (including its
`interfaces.js` ↔ `create-element.js` require cycle) is evaluated by Node's CommonJS loader
under the server's Node-native TypeScript loader, whose synchronous hooks also observe `require()`. It SHALL NOT cache an instance whose
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

#### Scenario: Sanitizer works under the server's native loader
- **GIVEN** a process started with `node --import <native-ts-register.mjs URL>` (as the dashboard server is)
- **WHEN** `loadPurify()` sanitizes `<svg><script>…</script><g/></svg>`
- **THEN** it returns `<svg><g></g></svg>` (jsdom initialized correctly, script stripped)

## REMOVED Requirements

### Requirement: EML sanitizer loads lazily so a broken jsdom cannot block server boot
**Reason**: Its rationale and one scenario assume the server runs under `node --import jiti-register`, which is no longer true.
**Migration**: See "EML sanitizer loads lazily via native require so a broken jsdom cannot block server boot". The behaviour is unchanged; the loader premise is updated.
