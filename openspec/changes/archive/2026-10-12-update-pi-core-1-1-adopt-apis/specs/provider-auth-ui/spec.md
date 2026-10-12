## ADDED Requirements

### Requirement: Providers page names the Azure provider rename

When `GET /api/provider-auth/legacy-provider-ids` returns a non-empty `legacyProviderIds`, the provider authentication section SHALL show one notice above the provider rows. The notice SHALL state that pi now calls the provider `azure`, list each location where the old id `azure-openai-responses` was found, state pi's consequence (such sessions fall back to another model and do not reuse their prompt cache), and give pi's fix (rename the key or id to `azure`, or sign in again with `/login`). It SHALL use the warning style with a text label, not colour alone, and SHALL disappear after a refresh that returns an empty list. An older server without the route, or a malformed body, SHALL show no notice.

#### Scenario: Notice lists locations
- **WHEN** `legacyProviderIds` reports the old id in `auth.json` and `settings.json:defaultProvider`
- **THEN** the section SHALL show the rename notice naming both locations

#### Scenario: No notice when nothing is legacy
- **WHEN** `legacyProviderIds` is empty or absent
- **THEN** no rename notice SHALL be shown
