## ADDED Requirements

### Requirement: Surfaced in the dashboard recommended-extensions manifest

The dashboard SHALL include `@blackbelt-technology/pi-image-fit` as an entry in the curated `RECOMMENDED_EXTENSIONS` manifest (`packages/shared/src/recommended-extensions.ts`) so the extension appears in the Recommended Extensions card and is installable via the standard recommended-extension install path. The entry MUST declare `source: "npm:@blackbelt-technology/pi-image-fit"`, `status: "optional"`, a non-empty `fallbackDescription` naming the resize thresholds, and a non-empty `unlocks` list. The entry MUST NOT declare `dashboardPlugin` or `toolsRegistered`, since the extension registers no tools and has no companion dashboard plugin. The entry MUST NOT be added to `BUNDLED_EXTENSION_IDS`.

#### Scenario: Entry present in the manifest

- **WHEN** `RECOMMENDED_EXTENSIONS` is read
- **THEN** exactly one entry has id `@blackbelt-technology/pi-image-fit` with `source` `npm:@blackbelt-technology/pi-image-fit` and `status` `optional`

#### Scenario: npm-source prefix invariant holds

- **WHEN** the manifest test checks that every npm-sourced entry uses the `npm:` prefix
- **THEN** the `pi-image-fit` entry satisfies the invariant (no git HTTPS URL)

#### Scenario: Not bundled in the Electron offline set

- **WHEN** `BUNDLED_EXTENSION_IDS` is checked against `RECOMMENDED_EXTENSIONS`
- **THEN** `@blackbelt-technology/pi-image-fit` is a recommended id but is NOT in `BUNDLED_EXTENSION_IDS`, and the bundled-set-is-subset-of-recommended invariant still holds

#### Scenario: Rendered in the Recommended Extensions card

- **WHEN** the dashboard fetches `/api/packages/recommended` and renders `RecommendedExtensions.tsx`
- **THEN** a card for `pi-image-fit` is shown with its enriched description and an install affordance, with no component code change required
