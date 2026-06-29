## ADDED Requirements

### Requirement: LLM-provider save rejects empty provider names

When the user saves LLM providers from the Settings panel, the save SHALL NOT silently discard a provider whose `name` is empty or whitespace-only. If any LLM-provider row has a blank name, the save task for the LLM-providers source SHALL fail with a visible error message identifying the problem, and SHALL leave the LLM-providers source dirty so the user can correct it. A provider row with a non-blank name and the other fields populated SHALL be persisted normally.

#### Scenario: Blank-name provider blocks save with error
- **WHEN** the user adds an LLM provider, fills Base URL and API Key, leaves the Name blank, and clicks Save
- **THEN** the LLM-providers save task SHALL report an error indicating the provider name is required
- **AND** the provider row SHALL remain in the panel (not silently dropped)
- **AND** the LLM-providers source SHALL stay dirty

#### Scenario: Named provider saves normally
- **WHEN** the user adds an LLM provider with a non-blank Name, Base URL, and API Key, and clicks Save
- **THEN** the provider SHALL be persisted to `~/.pi/agent/providers.json`
- **AND** the LLM-providers source SHALL become clean

### Requirement: Provider save never persists the masked sentinel as an apiKey

The server `PUT /api/providers` merge SHALL treat the masked sentinel value (`***`) as "keep the existing key" only when the named provider already exists in `~/.pi/agent/providers.json`. When an incoming provider's `apiKey` equals the masked sentinel but the provider is NOT present in the existing file, the merge SHALL NOT write the literal string `***` as the apiKey; it SHALL reject the write (or persist an empty key) so the credential is never corrupted to the sentinel.

#### Scenario: Masked key preserved when provider exists
- **WHEN** the existing file has `proxy` with `apiKey: "sk-real"` and the client PUTs `proxy` with `apiKey: "***"` and a changed `baseUrl`
- **THEN** the persisted `proxy.apiKey` SHALL remain `"sk-real"`

#### Scenario: Masked key without existing entry is not corrupted
- **WHEN** the client PUTs a `proxy` provider with `apiKey: "***"` and the existing file has no `proxy` entry
- **THEN** the server SHALL NOT persist `proxy.apiKey === "***"`
- **AND** the response SHALL indicate the key is required (or the entry SHALL be stored with no usable key) rather than silently writing the sentinel
