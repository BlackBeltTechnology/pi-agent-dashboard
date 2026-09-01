# markdown-fuzzy-search Specification

## Purpose

Provides fuzzy text search inside the markdown preview, with fuse.js matching, prev/next match navigation, and a reusable search component so any markdown surface can adopt it.

## Requirements

### Requirement: Fuzzy text search in markdown preview
The `MarkdownPreviewView` SHALL support an optional fuzzy text search capability powered by fuse.js. When enabled via a `searchable` prop, a search bar SHALL appear in the header area.

#### Scenario: Search bar visible when searchable enabled
- **WHEN** `MarkdownPreviewView` is rendered with `searchable={true}`
- **THEN** a search input SHALL appear in the header row

#### Scenario: Search bar hidden when not searchable
- **WHEN** `MarkdownPreviewView` is rendered without `searchable` or with `searchable={false}`
- **THEN** no search input SHALL appear

### Requirement: Fuzzy matching with fuse.js
The search SHALL use fuse.js to perform fuzzy matching against the text content of the rendered markdown. Typing in the search input SHALL trigger a search and highlight matching text regions in the rendered content.

#### Scenario: Fuzzy match finds partial text
- **WHEN** the user types "auth byp" and the content contains "auth-bypass-url-list"
- **THEN** the text "auth-bypass-url-list" SHALL be highlighted as a match

#### Scenario: Multiple matches highlighted
- **WHEN** the user types "auth" and the content contains "authentication" in 5 different sections
- **THEN** all 5 occurrences SHALL be highlighted

#### Scenario: No matches found
- **WHEN** the user types "xyznonexistent" and no content matches
- **THEN** the match counter SHALL show "0 results" and no highlights SHALL appear

#### Scenario: Empty search clears highlights
- **WHEN** the user clears the search input
- **THEN** all highlights SHALL be removed from the content

### Requirement: Match navigation with prev/next
The search overlay SHALL display a match counter (e.g., "3/12") and prev/next buttons (▲/▼) to navigate between highlighted matches. Navigating to a match SHALL scroll it into view.

#### Scenario: Match counter shows current position
- **WHEN** the search finds 12 matches and the user is on match 3
- **THEN** the counter SHALL display "3/12"

#### Scenario: Next button advances to next match
- **WHEN** the user clicks the ▼ (next) button while on match 3 of 12
- **THEN** match 4 SHALL be scrolled into view and the counter SHALL update to "4/12"

#### Scenario: Prev button goes to previous match
- **WHEN** the user clicks the ▲ (prev) button while on match 3 of 12
- **THEN** match 2 SHALL be scrolled into view and the counter SHALL update to "2/12"

#### Scenario: Navigation wraps around
- **WHEN** the user clicks ▼ (next) while on match 12 of 12
- **THEN** the navigation SHALL wrap to match 1 and scroll it into view

### Requirement: MarkdownSearch is a reusable component
The `MarkdownSearch` component SHALL accept a ref to the markdown content container and operate independently of the specific content being displayed. It SHALL be usable in any markdown preview context.

#### Scenario: Works with specs browser
- **WHEN** `MarkdownSearch` is used inside the specs browser view
- **THEN** it SHALL search across all concatenated spec content

#### Scenario: Works with change artifact preview
- **WHEN** `MarkdownSearch` is used inside a change artifact preview
- **THEN** it SHALL search within the artifact's markdown content

#### Scenario: Highlights cleared on content change
- **WHEN** the markdown content changes (e.g., tab switch) while a search is active
- **THEN** all previous highlights SHALL be cleared and the search SHALL re-run on the new content
