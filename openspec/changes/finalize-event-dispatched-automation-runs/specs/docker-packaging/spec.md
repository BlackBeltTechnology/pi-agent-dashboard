## ADDED Requirements

### Requirement: Base image ships PDF text/image extraction tools

The docker base image SHALL install `poppler-utils` so that `pdftotext` and
`pdftoppm` are available on `PATH` for flows that parse PDF documents (e.g. the
invoicebot document-parsing node). The tools SHALL persist into the final image
(installed in the base stage, not purged with build tooling).

#### Scenario: PDF parsing tools present in the running container

- **WHEN** a flow in a spawned session shells out to `pdftotext` or `pdftoppm`
- **THEN** the binaries resolve on `PATH` and the parse step succeeds instead of
  holding the item for a missing-tool error.
