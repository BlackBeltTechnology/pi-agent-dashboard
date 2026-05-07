## ADDED Requirements

### Requirement: Design-model vision-based mocking
The system SHALL support a vision-capable agent (`sandbox-designer` skill) that receives before-screenshots and a user story, and returns a Tailwind HTML mockup with all visual states annotated via HTML comments.

#### Scenario: Mockup generation — valid output
- **WHEN** the `sandbox-designer` agent receives:
  - One or more before-screenshots (PNG images of the current dashboard UI)
  - A user story describing the desired UI change
- **THEN** the agent SHALL produce a single `mockup.html` file containing:
  - Valid HTML (parseable by any browser)
  - Tailwind CSS utility classes only (no raw CSS, no inline styles except where Tailwind has no equivalent)
  - At least one `<!-- state: <name> -->` HTML comment per visual state described in the user story
- **AND** every `<!-- state: ... -->` comment SHALL immediately precede the HTML block for that state

#### Scenario: Required state annotations
- **WHEN** a user story describes a UI change that has multiple visual states (e.g., default, hover, error, loading, empty, disabled)
- **THEN** the mockup SHALL include a labeled `<!-- state: ... -->` block for EVERY state mentioned in the user story
- **AND** states not explicitly mentioned but inherent to the UI pattern (e.g., empty state for a list, error state for a form) MAY be included at the agent's discretion

#### Scenario: Mockup validation — self-check
- **WHEN** the `sandbox-designer` agent produces a `mockup.html`
- **THEN** the agent SHALL perform a self-validation step:
  - Open `mockup.html` in a browser
  - Screenshot the rendered result
  - Compare the mockup screenshot against the original before-screenshots
  - Verify that every `<!-- state: ... -->` block in the user story is visually represented
- **AND** if the mockup fails self-validation (missing state, wrong layout), the agent SHALL regenerate the mockup with a note about what was corrected

#### Scenario: Mockup is a visual contract, not pixel-perfect
- **WHEN** an implementation model reads `mockup.html`
- **THEN** the model SHALL treat the mockup as a visual contract describing structure, layout, and state coverage
- **AND** the model MAY adjust spacing, colors, and exact pixel values to match the dashboard's existing design patterns
- **AND** the invariant SHALL be: all annotated visual states are represented, structural regions (which elements appear, their relative order) are preserved

### Requirement: sandbox-designer skill documentation
The skill SHALL be documented at `.pi/skills/sandbox-designer/SKILL.md`.

#### Scenario: Skill documents recommended model
- **WHEN** an agent reads the skill
- **THEN** SKILL.md SHALL recommend Claude Sonnet or Opus with vision capability
- **AND** SHALL note that any vision-capable model MAY be used

#### Scenario: Skill documents input/output contract
- **WHEN** an agent reads the skill
- **THEN** SKILL.md SHALL document:
  - Input: user story (prose text) + before-screenshots (PNG file paths) + optional `design.md` context
  - Output: `mockup.html` with Tailwind classes and `<!-- state: ... -->` comments
  - Constraints: Tailwind-only, one comment per state, valid HTML
