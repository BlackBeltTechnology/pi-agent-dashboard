## Purpose

Defines the anti-slop skill package: an advisory, countable design-quality suite (review checklist, redesign protocol, opt-in image direction, opt-in brandkit) that serves product UI, marketing sites and new sites, adapted from a pinned upstream taste-skill version.

## ADDED Requirements

### Requirement: Pinned upstream provenance
The anti-slop package SHALL ship an upstream provenance record naming the source repository, a full 40-hex commit SHA, the commit date, the upstream license, and a section map in which every upstream section of each adapted upstream skill is listed as either mapped to a named package skill/section or `dropped` with a reason. Every package skill adapted from upstream SHALL name its upstream skill and the pinned short SHA in its frontmatter.

#### Scenario: Provenance record is complete
- **WHEN** the package is inspected
- **THEN** a provenance record exists with repository, 40-hex SHA, date and license
- **AND** every adapted package skill's frontmatter names its upstream skill and a SHA prefix of the pinned commit

#### Scenario: Unmapped upstream section is visible
- **WHEN** an upstream section of an adapted skill is neither mapped nor marked `dropped`
- **THEN** the provenance record is incomplete and verification fails

### Requirement: Package declares every shipped skill
The package manifest SHALL list exactly the skill directories it ships: `anti-slop-frontend`, `anti-slop-redesign`, `anti-slop-image-direction`, `anti-slop-brandkit`. Each SHALL have frontmatter that passes the repository skill-frontmatter guard.

#### Scenario: Manifest and directories agree
- **WHEN** the package manifest's skill list is compared with the skill directories on disk
- **THEN** the two sets are equal

### Requirement: Design Read and surface profile precede any review or generation
The `anti-slop-frontend` skill SHALL require the agent to declare a one-line Design Read before reviewing or generating UI. The read states a surface profile (`product-ui`, `marketing`, or `new-site`), audience, mood, and the three dial values. The profile SHALL determine which rule groups apply:
- universal tells apply to all profiles;
- marketing tells and layout discipline apply only to `marketing` and `new-site`.

#### Scenario: Product UI skips marketing rules
- **WHEN** the declared profile is `product-ui`
- **THEN** universal tells apply
- **AND** marketing tells and layout discipline do not apply

#### Scenario: Marketing applies the full set
- **WHEN** the declared profile is `marketing` or `new-site`
- **THEN** universal tells, marketing tells and layout discipline all apply

#### Scenario: Missing Design Read
- **WHEN** a review or generation is reported without a declared Design Read
- **THEN** the skill's verification step is not satisfied

### Requirement: Countable rules and grep-able pre-flight
Every rule in `anti-slop-frontend` SHALL be countable or binary. The skill SHALL end with a pre-flight checklist whose items each reference the rule they verify, and which includes the added theme-parity, layout-discipline and z-index restraint checks.

#### Scenario: Pre-flight covers added rules
- **WHEN** the pre-flight checklist is read
- **THEN** it contains items for theme parity, layout discipline (marketing only) and z-index restraint alongside the existing em-dash, accent, font, fake-data, fake-screenshot, contrast and motion items

### Requirement: Theme parity per profile
The suite SHALL express theme parity as pass/fail items:
- for `product-ui`:
  - zero raw color literals added by the change in shipped UI source (tests, fixtures, stories, SVG files and token-definition files excluded);
  - no new violation from the project's token guard when one exists;
  - screenshots exist for the default theme in dark, the default theme in light, and one non-default palette;
- for `marketing`: zero added raw color literals (same scope), and screenshots in light and dark;
- for `new-site`: zero added raw color literals (same scope), and one screenshot per shipped mode.

Visual judgment of the screenshots SHALL be recorded as a non-gating note.

#### Scenario: Raw color literal in product UI
- **WHEN** a `product-ui` change introduces a raw color literal instead of a theme token
- **THEN** the theme-parity check is flagged

#### Scenario: Marketing parity
- **WHEN** a `marketing` surface is reviewed
- **THEN** the review records results for both light and dark modes

#### Scenario: Missing palette screenshot
- **WHEN** a `product-ui` review has no screenshot for a non-default palette
- **THEN** the theme-parity item fails

### Requirement: Redesign mode protocol
The `anti-slop-redesign` skill SHALL require the agent to:
- declare a mode (`greenfield`, `preserve`, or `overhaul`) before any edit;
- audit the existing surface before changing it;
- apply modernisation levers in a stated priority order.

Defaults: `preserve` for `product-ui` and `marketing`; `greenfield` for `new-site`. `overhaul` SHALL require explicit user confirmation. In `preserve` and `overhaul`, the following SHALL NOT change unless the change is explicitly listed and confirmed: routes/URLs, navigation labels, form field names, brand wordmark, legal copy, keyboard shortcuts, `data-testid` attributes.

#### Scenario: Audit before edit
- **WHEN** a redesign is requested on an existing surface
- **THEN** a mode and an audit of the current surface are produced before any edit

#### Scenario: Protected element change requires confirmation
- **WHEN** a `preserve` redesign would rename a route, nav label, form field name, keyboard shortcut or `data-testid`
- **THEN** the change is listed explicitly and requires user confirmation before it is applied

#### Scenario: Overhaul needs confirmation
- **WHEN** the agent proposes `overhaul` mode
- **THEN** it obtains explicit user confirmation before proceeding

### Requirement: Image direction is opt-in, confirmed, and never for product UI
The `anti-slop-image-direction` skill SHALL generate reference images only when all of these hold:
- the profile is `marketing` or `new-site`;
- the user explicitly requested image direction;
- the user confirmed a plan stating the image count, the backend, and that generation is paid.

It SHALL generate images through the image-generation CLI, one image per planned section, into the mockup's reference folder, using only the backend named in the confirmed plan. Changing backend SHALL require a new confirmation. When no interactive question tool is available, the run SHALL be treated as headless and SHALL generate nothing.

#### Scenario: Backend switch needs reconfirmation
- **GIVEN** a confirmed plan naming the Gemini backend
- **WHEN** Gemini credentials are missing but the pi backend is available
- **THEN** no image is generated through the pi backend until the user confirms a plan naming it

#### Scenario: Product UI refuses image direction
- **WHEN** image direction is requested for a `product-ui` surface
- **THEN** no image is generated and the skill states that image direction does not apply to product UI

#### Scenario: Confirmed plan generates per section
- **GIVEN** a `marketing` page with N planned sections and a user-confirmed plan
- **WHEN** image direction runs
- **THEN** N reference images are written, one per section

#### Scenario: Headless run
- **WHEN** image direction is invoked without an interactive confirm capability
- **THEN** no image is generated and a text-only direction brief is produced

### Requirement: Generated images are direction, not source
Image direction SHALL produce a written direction brief (layout family, spacing rhythm, palette values, type character, and universal tells observed in the images). The brief SHALL be an input to mockup grounding and SHALL NOT override documented-rule or accessibility gates. Text visible in generated images SHALL be treated as placeholder and SHALL NOT be transcribed into copy. Universal tells found in an image SHALL be excluded from the brief.

#### Scenario: Image text is not copied
- **WHEN** a generated image contains rendered headline text
- **THEN** the direction brief and resulting mockup do not reproduce that text verbatim from the image

#### Scenario: Tell in image is excluded
- **WHEN** analysis finds an AI-purple glow in a generated image
- **THEN** the brief lists it as an observed tell and does not carry it into the palette direction

### Requirement: Image backend fallback
When the image-generation CLI is unavailable or has no usable credentials, image direction and brandkit SHALL report the reason and fall back to a text-only output instead of failing the task.

#### Scenario: No credentials
- **WHEN** image direction runs with no image backend credentials
- **THEN** the reason is reported and a text-only direction brief is produced

### Requirement: Brandkit is opt-in and proposal-only
The `anti-slop-brandkit` skill SHALL run only for `new-site` work on explicit request. It SHALL apply the same confirmed-plan gate (image count, backend, paid) and the same headless rule as image direction. It SHALL produce a brand board image plus a written brand brief (palette, type pairing, logo concept rationale) in the mockup folder. It SHALL NOT write brand values into project tokens or contracts without user approval, and SHALL label logos as concepts.

#### Scenario: Brandkit without confirmation
- **WHEN** brandkit is requested but the user has not confirmed the paid generation plan
- **THEN** no image is generated

#### Scenario: No auto-adoption
- **WHEN** a brandkit run completes
- **THEN** project tokens and UI contracts are unchanged until the user approves the brand brief

### Requirement: Advisory authority under the mockup loop
All suite skills SHALL be advisory. When run alongside the frontend mockup loop, their findings SHALL feed the loop's fix step and SHALL NOT override an accessibility or severity gate owned by the loop.

#### Scenario: Conflict with a gate
- **WHEN** an anti-slop recommendation conflicts with a WCAG-AA gate result
- **THEN** the gate result stands and the recommendation is recorded as overridden
