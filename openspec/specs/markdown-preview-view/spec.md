## Purpose

Define the in-app markdown preview surface: a reusable `MarkdownPreviewView` that replaces the chat view to render markdown content (OpenSpec proposals/specs, package READMEs, skill SKILL.md) with navigation chrome.
## Requirements
### Requirement: Markdown preview replaces chat view
When a markdown preview is active, the main area SHALL show the preview instead of the ChatView, StatusBar, and CommandInput. Only the SessionHeader and TokenStatsBar SHALL remain visible above the preview.

#### Scenario: Preview active
- **WHEN** the user opens a markdown preview
- **THEN** the ChatView, StatusBar, and CommandInput SHALL be hidden
- **AND** the MarkdownPreviewView SHALL be shown in their place

#### Scenario: Preview dismissed
- **WHEN** the user clicks the back button in the preview
- **THEN** the MarkdownPreviewView SHALL be hidden
- **AND** the ChatView, StatusBar, and CommandInput SHALL be restored

#### Scenario: Session change clears preview
- **WHEN** the user selects a different session while a preview is active
- **THEN** the preview SHALL be dismissed and the new session's chat SHALL be shown

### Requirement: Generic markdown preview component
The MarkdownPreviewView SHALL be a reusable component that renders markdown content with a back button, an optional title, and an optional tab bar. It SHALL use the existing MarkdownContent component for rendering, and SHALL pass `frontmatter="properties"` to it so that a leading YAML frontmatter block renders as a Properties panel rather than being hidden.

#### Scenario: Basic rendering
- **WHEN** MarkdownPreviewView is given `content` and `title` props
- **THEN** it SHALL render a back button, the title, and the markdown content in a scrollable container

#### Scenario: Tab bar navigation
- **WHEN** MarkdownPreviewView is given `tabs` and `activeTab` props
- **THEN** it SHALL render a tab bar below the title allowing the user to switch between tabs
- **AND** the active tab SHALL be visually distinguished

#### Scenario: Loading state
- **WHEN** the `isLoading` prop is true
- **THEN** the component SHALL show a loading indicator instead of markdown content

#### Scenario: Error state
- **WHEN** the `error` prop is set
- **THEN** the component SHALL display the error message instead of markdown content

#### Scenario: Frontmatter renders as Properties panel
- **WHEN** the `content` begins with a YAML frontmatter block (e.g. an OpenSpec proposal or spec)
- **THEN** the rendered markdown SHALL show a collapsed Properties panel above the body, not a mangled heading

