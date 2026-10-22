# Spec Delta

## MODIFIED Requirements

### Requirement: Mermaid SVG sanitization is final and fail-closed
The mermaid renderer SHALL sanitize the rendered SVG with DOMPurify — SVG and
SVG-filter profiles, `<foreignObject>` treated as an HTML integration point so
HTML labels including `<br>` line breaks survive, form controls and embeds
forbidden — and SHALL NOT use a regular expression for it. Sanitization SHALL
be the last transformation applied before the SVG is cached or injected, for
original and repaired renders alike. A DOMPurify instance that reports itself
unsupported SHALL be treated as a failure; a failure SHALL NOT cache or inject
the unsanitized SVG. Diagram-level directives (`%%{init}%%`) SHALL NOT be able
to override the theme CSS or font family that mermaid emits into the SVG's
`<style>` element. When the browser supports Trusted Types, the sanitized SVG
SHALL be injected as a trusted value created by the sanitized-HTML policy. The
default-node colorize step SHALL operate on an already-sanitized DOM (DOMPurify
`RETURN_DOM`), never on a string parse of unsanitized renderer output, so it
reaches no HTML sink and never the default policy.

#### Scenario: SVG xlink:href javascript dropped
- **WHEN** a rendered diagram contains an `<a xlink:href="javascript:alert(1)">`
- **THEN** the injected SVG SHALL NOT retain the `javascript:` reference

#### Scenario: event handler dropped in any quoting form
- **WHEN** the rendered SVG contains elements with event-handler attributes written double-quoted, single-quoted and unquoted
- **THEN** the injected SVG SHALL carry no event-handler attribute

#### Scenario: foreignObject labels preserved
- **WHEN** a flowchart uses HTML labels rendered in `<foreignObject>`, including a `<br>` line break
- **THEN** the injected SVG SHALL still display the full label text on separate lines

#### Scenario: diagram types keep their features
- **WHEN** a flowchart with arrowhead markers, a sequence diagram, a class diagram and an ER diagram are rendered
- **THEN** each injected SVG SHALL keep its markers, theme `<style>` and label text

#### Scenario: init directive cannot inject theme CSS
- **WHEN** a diagram starts with `%%{init: {"themeCSS": "@import url(//evil.example/x.css); * {display:none}", "fontFamily": "x;*{display:none}"}}%%`
- **THEN** the injected SVG's `<style>` SHALL contain neither the `@import` nor the injected rules

#### Scenario: repaired render sanitized
- **WHEN** a diagram's original source fails to render and the rule-repaired source renders an SVG containing an event-handler attribute
- **THEN** the injected SVG SHALL carry no event-handler attribute

#### Scenario: sanitizer failure fails closed
- **WHEN** the sanitizer throws or reports itself unsupported during a render
- **THEN** the block SHALL show either the error view or a repaired render that itself passed sanitization, and no unsanitized SVG SHALL be injected or stored in the outcome cache

#### Scenario: colorize survives Trusted Types enforcement
- **WHEN** a flowchart with default (un-authored) nodes renders while Trusted Types is enforced
- **THEN** its default nodes carry the theme accent tint exactly as without Trusted Types

## ADDED Requirements

### Requirement: Document preview HTML is injected as a trusted value
When the browser supports Trusted Types, server-sanitized document preview HTML (AsciiDoc, and DOCX when rendered as HTML) and the client-side KaTeX rewrite SHALL be injected as trusted values created by the sanitized-HTML policy. The script-less sandboxed e-mail body frame SHALL also receive a trusted value. The rendered output SHALL be unchanged.

#### Scenario: AsciiDoc under enforcement
- **WHEN** an `.adoc` file with headings, a table, `stem:[a^2]` and a mermaid block is previewed while Trusted Types is enforced
- **THEN** it renders identically to the preview without Trusted Types and raises no violation

#### Scenario: E-mail body under enforcement
- **WHEN** an `.eml` file is previewed while Trusted Types is enforced
- **THEN** the body renders inside the script-less sandboxed frame and raises no violation
