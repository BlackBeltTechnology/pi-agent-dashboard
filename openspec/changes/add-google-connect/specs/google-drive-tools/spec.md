## Purpose

Agent tools that search, read and change a connected account's Google Drive through Google Connect leases, keeping local file access inside the session workspace and every Drive change confirmed.

## ADDED Requirements

### Requirement: Drive levels
Drive SHALL offer levels `files` (only files the user picked or the app created), `read` (read all files) and `write` (read and change all files); `read` and `write` require an own OAuth client. The settings SHALL explain that `files` cannot see the user's existing files.

#### Scenario: Files level sees only app files
- **WHEN** the account has Drive at `files` and the agent searches for an existing user document
- **THEN** the search returns no result for it and the tool result notes the `files` level limit

### Requirement: Drive file picking
At level "files", the plugin SHALL provide `gdrive_pick`, which asks the user to pick Drive files in the dashboard with Google's file picker and returns the picked file ids, names and types; picked files become readable at level "files". The picker SHALL be available only for built-in accounts in a browser on the dashboard host; otherwise the tool SHALL fail with `picker_unavailable` and say why.

#### Scenario: User picks a spreadsheet
- **WHEN** the agent calls `gdrive_pick` and the user picks `Budget 2026` in the picker
- **THEN** the tool returns its file id and the agent can export it with `gdrive_export`

#### Scenario: Picker on a remote dashboard
- **WHEN** `gdrive_pick` runs while the dashboard is opened through a tunnel
- **THEN** the tool fails with `picker_unavailable` and explains that only app-created files are visible at level "files"

### Requirement: Drive read tools
The plugin SHALL provide `gdrive_search` (by text, name, type or folder), `gdrive_get` (metadata), `gdrive_download` (binary file to a workspace path) and `gdrive_export` (a Google Docs, Sheets or Slides file to PDF, DOCX, XLSX, PPTX, CSV or plain text at a workspace path). Search results SHALL include id, name, type, parent folder, modified time and web link.

#### Scenario: Export a Google Doc
- **WHEN** the agent exports a Google Doc as `docx` to `out/report.docx`
- **THEN** the file is written to the workspace and its path and size are returned

### Requirement: Drive downloads stay in the workspace
Download and export SHALL write only inside the session's working directory after resolving symbolic links, SHALL refuse paths outside it, and SHALL NOT overwrite an existing file.

#### Scenario: Traversal refused
- **WHEN** `gdrive_download` targets `../../.ssh/x`
- **THEN** the call fails and nothing is written

### Requirement: Drive write tools
The plugin SHALL provide `gdrive_upload` (a workspace file into a Drive folder), `gdrive_create_folder`, `gdrive_move` and `gdrive_trash`. Each SHALL ask the user to confirm, showing the account, file names and target folder. Upload SHALL read only files inside the working directory. The plugin SHALL NOT delete files permanently or change sharing. No interactive UI, denial, dismissal or timeout SHALL leave Drive unchanged.

#### Scenario: Denied trash
- **WHEN** the user denies `gdrive_trash`
- **THEN** the file stays in place

#### Scenario: Upload outside workspace refused
- **WHEN** `gdrive_upload` names `/etc/passwd`
- **THEN** the call fails before any confirmation or upload
