## ADDED Requirements

### Requirement: External links open in new context
The `MarkdownContent` component SHALL render anchor (`<a>`) elements such that clicking an external URL never strands the user on a page outside the dashboard. An external URL is any URL whose resolved origin differs from the current page's origin. Same-document fragment references (`#id`) and same-origin URLs SHALL render as bare anchors and remain in-document.

#### Scenario: External absolute URL in markdown content
- **WHEN** the content contains a link whose href resolves to a different origin than the current page (e.g. `[docs](https://example.com)`)
- **THEN** the rendered `<a>` SHALL have `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Markdown autolink
- **WHEN** the content contains an autolink (`<https://example.com>` or a bare URL that GFM linkifies)
- **THEN** the rendered `<a>` SHALL have `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Fragment-only href stays in-document
- **WHEN** the content contains a link whose href begins with `#` (e.g. `[top](#top)`)
- **THEN** the rendered `<a>` SHALL NOT have a `target` attribute, so the browser performs in-document scrolling

#### Scenario: Same-origin relative href stays in-window
- **WHEN** the content contains a link whose href resolves to the same origin as the current page (e.g. `[settings](/settings)`)
- **THEN** the rendered `<a>` SHALL NOT have a `target` attribute

#### Scenario: Click is safe from reverse tabnabbing
- **WHEN** the rendered anchor has `target="_blank"`
- **THEN** it SHALL also have `rel="noopener noreferrer"` so the opened page cannot access `window.opener` or leak referrer information
