## ADDED Requirements

### Requirement: Transcript web links render as a single no-wrap pill

A web link rendered in the chat transcript with a provider icon SHALL render as one inline pill that contains the icon and the label and does not wrap internally. When the pill is wider than the line, the label SHALL be truncated visually at the end; the DOM text, `title` and copy text SHALL keep their existing values. Web links outside the transcript SHALL keep their existing rendering.

#### Scenario: icon and URL form one unbreakable unit

- **GIVEN** an assistant message with the autolink `https://github.com/BlackBeltTechnology/pi-agent-dashboard/security/dependabot`
- **WHEN** the link renders in the transcript
- **THEN** the anchor is the pill: it has no-wrap styling and contains the provider icon and the label
- **AND** no line break can occur between the icon and the label

#### Scenario: long URL keeps its start visible

- **GIVEN** a transcript web link whose label is wider than the bubble
- **WHEN** the link renders
- **THEN** the label is truncated at the end with an ellipsis
- **AND** the anchor's `title` and `data-copy-text` (for an autolink) still hold the full URL

#### Scenario: web links in tool output and markdown match

- **WHEN** the same URL renders through `UrlLink` (tool output in the transcript) and through a markdown anchor
- **THEN** both use the same pill classes as transcript file links

#### Scenario: outside the transcript nothing changes

- **GIVEN** a web link rendered without a `LinkResolutionProvider`
- **WHEN** it renders
- **THEN** it has no icon, no pill classes and no label wrapper
