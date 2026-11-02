# Spec Delta — editor-pane-plugin-tabs

## ADDED Requirements

### Requirement: Plugin tabs may own opening files by extension

An `editor-pane-tab` claim MAY declare `fileExtensions`. When a workspace file under the session's working directory is opened from any entry point (file tree, deep link, canvas target, tool links and buttons, split open), and its extension (compared case-insensitively) matches an enabled claim's `fileExtensions`, the pane SHALL open or focus `<pathPrefix>:file:<cwd-relative path>` instead of a file tab, and SHALL NOT load the file viewer.

#### Scenario: Claimed extension redirects
- **WHEN** an enabled plugin claims `editor-pane-tab` with `pathPrefix: "gdoc"` and `fileExtensions: [".gdoc"]`, and the user opens `notes.gdoc` from the file tree
- **THEN** the pane SHALL open the tab `gdoc:file:notes.gdoc`, and no file viewer SHALL mount for `notes.gdoc`

#### Scenario: Deep link redirects
- **WHEN** a `?file=notes.gdoc` deep link is followed in that session
- **THEN** the pane SHALL open `gdoc:file:notes.gdoc`

#### Scenario: Second open focuses
- **WHEN** `gdoc:file:notes.gdoc` is already open and the user opens `notes.gdoc` again
- **THEN** the existing tab SHALL be focused, and no second tab SHALL open

#### Scenario: Plugin disabled
- **WHEN** the claiming plugin is disabled and the user opens `notes.gdoc`
- **THEN** the file SHALL open in the normal file viewer

#### Scenario: Split open redirects
- **WHEN** the user opens `notes.gdoc` into a split
- **THEN** the split SHALL show `gdoc:file:notes.gdoc`, and no file viewer SHALL mount

#### Scenario: Restored file tab stays a file tab
- **WHEN** pane state restored a plain file tab for `notes.gdoc` saved before the plugin was enabled
- **THEN** that tab SHALL stay a file tab until closed, and new opens of `notes.gdoc` SHALL redirect

### Requirement: Redirect can be bypassed for one open

An open request MAY ask to bypass the redirect. The pane SHALL honour it only when it comes from the claiming plugin's own tab and names the file in that tab's own path, opening the file as a plain file tab. Any other bypass request SHALL be ignored, and the redirect SHALL apply.

#### Scenario: Show pointer file
- **WHEN** the `gdoc:file:notes.gdoc` tab asks to show its file
- **THEN** `notes.gdoc` SHALL open in the normal file viewer, and the plugin tab SHALL stay open

#### Scenario: Foreign bypass ignored
- **WHEN** the `gdoc:file:notes.gdoc` tab asks to bypass the redirect for `other.gdoc`
- **THEN** the request SHALL be ignored, and `other.gdoc` SHALL NOT open as a plain file tab

### Requirement: Redirect extension claims are validated

Manifest validation SHALL reject a `fileExtensions` entry that does not match the file-handler extension rule, that the file-handler slot treats as unclaimable, or that the shared file-kind classifier recognizes as a known kind. Registry generation SHALL fail, with an error naming both plugins and the extension, when two plugins' `editor-pane-tab` claims declare the same extension, or when an extension is declared both in a `fileExtensions` list and by an `editor-pane-file-handler` claim.

#### Scenario: Built-in extension refused
- **WHEN** a plugin declares `fileExtensions: [".md"]`
- **THEN** manifest validation SHALL fail with an error naming the plugin and `.md`

#### Scenario: Two plugins redirect the same extension
- **WHEN** two plugins both declare `fileExtensions: [".gdoc"]`
- **THEN** registry generation SHALL fail with an error naming both plugins and `.gdoc`

#### Scenario: Redirect collides with a file handler
- **WHEN** one plugin redirects `.gdoc` and another claims `.gdoc` as a file handler
- **THEN** registry generation SHALL fail with an error naming both plugins and `.gdoc`
