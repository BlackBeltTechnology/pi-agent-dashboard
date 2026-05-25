## MODIFIED Requirements

### Requirement: Uniform code payload font-size

The code/diff payload region of `ReadToolRenderer`, `WriteToolRenderer`, `EditToolRenderer`, `BashToolRenderer`, and `GenericToolRenderer` SHALL render at a single shared font-size of 12 px on both mobile and desktop. The shared size SHALL be applied via a single reusable utility class (`.text-code`) declared in `packages/client/src/index.css`. Non-payload chrome (filename labels, status text, action buttons, `AskUserToolRenderer` controls) is OUT OF SCOPE for this requirement and retains its existing sizing.

`DiffPanel` (the full-screen diff viewer) and markdown code blocks inside assistant prose (`MarkdownContent`) are explicitly OUT OF SCOPE and SHALL retain their existing font-sizes.

#### Scenario: Read and Edit cards for the same file render at the same font-size

- **GIVEN** a chat view contains a `Read(foo.ts)` tool call followed by an `Edit(foo.ts)` tool call
- **WHEN** both cards have completed and their content is visible
- **THEN** the computed `font-size` of the code payload in the Read card SHALL equal the computed `font-size` of the diff payload in the Edit card
- **AND** that shared value SHALL be 12 px

#### Scenario: Mobile and desktop Edit cards render at the same font-size

- **GIVEN** an `EditToolRenderer` is rendered with both `oldText` and `newText` populated
- **WHEN** the viewport is narrow enough to trigger the mobile fallback `DiffView`
- **THEN** the computed `font-size` of the diff lines SHALL be 12 px
- **AND** SHALL equal the computed `font-size` of the desktop `RichDiff` payload at a wider viewport

#### Scenario: Bash and Generic output payload match Read

- **GIVEN** a chat view contains a `Bash` tool call result and a `Read` tool call result
- **WHEN** both cards have completed
- **THEN** the computed `font-size` of the `<pre>` output in the Bash card SHALL equal the computed `font-size` of the code payload in the Read card (both 12 px)

#### Scenario: Filename header is unaffected

- **GIVEN** any of the affected tool renderers is displayed
- **WHEN** the filename label / status row above the payload is inspected
- **THEN** the filename label SHALL retain its existing `text-xs` styling and SHALL NOT be coerced through the shared `.text-code` utility
