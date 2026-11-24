# google-docs-tools Specification

## Purpose
Agent tools that read, create and edit Google Docs of a connected account through Google Connect leases, with every edit confirmed and guarded against overwriting concurrent changes.

## Requirements

### Requirement: Docs read tool
The plugin SHALL provide `gdocs_get` taking a document id or Docs URL, returning title, revision id and the body as text with headings, lists and tables marked. Long bodies SHALL be returned in pages with an offset to continue.

#### Scenario: Read by URL
- **WHEN** the agent passes `https://docs.google.com/document/d/<id>/edit`
- **THEN** the document with `<id>` is returned with its revision id

### Requirement: Docs write tools
The plugin SHALL provide `gdocs_create` (title and optional initial text), `gdocs_append_text` and `gdocs_replace_text` (replace all matches). Each SHALL require Docs at level write and ask the user to confirm, showing account, document title and a preview of the text or the match and replacement with the match count. No interactive UI, denial, dismissal or timeout SHALL leave the document unchanged.

#### Scenario: Denied replace
- **WHEN** the user denies `gdocs_replace_text`
- **THEN** the document is unchanged

### Requirement: Docs edits do not clobber concurrent changes
An edit that carries the revision id the agent read SHALL fail with `revision_changed` when the document changed since, and SHALL not apply.

#### Scenario: Someone edited meanwhile
- **WHEN** a collaborator edits the document after `gdocs_get` and the agent then calls `gdocs_append_text` with the old revision id
- **THEN** the tool fails with `revision_changed`
