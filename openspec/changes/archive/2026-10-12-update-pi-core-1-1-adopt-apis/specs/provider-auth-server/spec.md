## ADDED Requirements

### Requirement: Legacy Azure provider id is reported

pi 1.0.3 renamed the provider `azure-openai-responses` to `azure`. Sessions that use the old id fall back to another model and lose their prompt cache. The server SHALL scan the files in pi's agent directory (honouring `PI_CODING_AGENT_DIR`). The scan itself SHALL be read-only and side-effect free: no lock, no quarantine copy, no write. Each file read SHALL be isolated, so one failing read cannot affect the others:
- `auth.json` top-level keys equal to the old id;
- `settings.json`: `defaultProvider` equal to the old id or starting with `<old id>/`, `enabledModels` entries equal to the old id or starting with `<old id>/`, and `modelThinkingLevels` keys equal to the old id or starting with `<old id>/`;
- `models.json` `providers` keys equal to the old id.

The server SHALL expose the result at `GET /api/provider-auth/legacy-provider-ids` as `{ legacyProviderIds }`, a list of `{ legacyId: "azure-openai-responses", newId: "azure", locations }`, where `locations` names each matched place. The list SHALL be empty when nothing matched. The `GET /api/provider-auth/status` body SHALL stay a bare array (clients pin that shape), so it does not carry the list. The scan SHALL NOT return, log or serialize any credential or setting value. A missing, unreadable or unparseable file SHALL be skipped without failing the response. The custom-endpoint API type `azure-openai-responses` SHALL NOT be reported, because it is still a valid pi-ai API.

#### Scenario: Old key in auth.json
- **WHEN** `auth.json` has a top-level key `azure-openai-responses`
- **THEN** `legacyProviderIds` SHALL contain one entry whose `locations` include `auth.json`
- **AND** the response SHALL contain no value from that key

#### Scenario: Old id in settings
- **WHEN** `settings.json` has `defaultProvider: "azure-openai-responses"` and an `enabledModels` entry `azure-openai-responses/gpt-5`
- **THEN** the entry's `locations` SHALL include `settings.json:defaultProvider` and `settings.json:enabledModels`

#### Scenario: Prefix needs a boundary
- **WHEN** `enabledModels` contains `azure-openai-responses2/gpt-5` only
- **THEN** `legacyProviderIds` SHALL be empty

#### Scenario: Nothing to report
- **WHEN** no scanned file contains the old id
- **THEN** `legacyProviderIds` SHALL be an empty list

#### Scenario: API type is not a provider id
- **WHEN** `models.json` defines a custom provider `my-azure` with `api: "azure-openai-responses"`
- **THEN** `legacyProviderIds` SHALL be empty

#### Scenario: Old provider key in models.json
- **WHEN** `models.json` has a `providers` key `azure-openai-responses`
- **THEN** the entry's `locations` SHALL include `models.json:providers`

#### Scenario: The scan writes nothing on a corrupt file
- **WHEN** `auth.json` contains unparseable bytes and `scanLegacyProviderIds()` runs
- **THEN** the scan SHALL return without throwing, report nothing for `auth.json`, leave `auth.json` byte-identical, and create no file (the status route's existing quarantine behaviour is unchanged)
