## Purpose

Defines single-provider write semantics for `~/.pi/agent/providers.json`, so one custom OpenAI-compatible endpoint can be created, edited, or deleted without the caller resending — and risking the loss of — every other entry in the file.

## ADDED Requirements

### Requirement: Single-provider update endpoint

The server SHALL expose `PATCH /api/providers/:name` accepting a partial provider body (`baseUrl`, `api`, `apiKey`) and applying it to the named entry in `~/.pi/agent/providers.json`. The endpoint SHALL **upsert**: a name not present in the file SHALL be created. The provider name SHALL be taken from the URL segment: callers percent-encode it (provider names may contain characters that are otherwise path-significant) and the server SHALL decode the segment once and use the decoded value verbatim as the `providers.json` key, without further normalisation. A name that cannot survive the path (for example `..`) is not addressable through these routes; the retained whole-map write remains available for it.

Field semantics SHALL be explicit, not implied by "partial": an omitted `baseUrl`, `api`, or `apiKey` SHALL preserve the stored value; an `apiKey` equal to the masked sentinel SHALL preserve the stored value; only an explicit non-sentinel value SHALL replace one. Renaming SHALL NOT be expressed through `PATCH`: the cached health is keyed by name, and no single request can express a key change. The name SHALL therefore be immutable in the Edit surface — a client SHALL NOT offer a rename that it implements as a delete plus a create, because a rejected second request would leave the original entry destroyed. Renaming is achieved by adding the new endpoint and removing the old one, in that order, as two deliberate operator actions.

`PUT /api/providers` SHALL be retained unchanged for any whole-map caller.

#### Scenario: Update one provider without resending the others

- **WHEN** the file holds `proxy` and `vllm`, and a client sends `PATCH /api/providers/proxy` with `{ baseUrl: "https://new" }`
- **THEN** `proxy.baseUrl` SHALL be updated
- **AND** `vllm` SHALL remain in the file unchanged

#### Scenario: PATCH creates an absent provider

- **WHEN** the file holds no `vllm` entry and a client sends `PATCH /api/providers/vllm` with a base URL, api type, and key
- **THEN** the entry SHALL be created

#### Scenario: Omitted fields preserve stored values

- **WHEN** a client sends `PATCH /api/providers/proxy` with only `{ api: "openai-completions" }`
- **THEN** the stored `baseUrl` and `apiKey` SHALL be unchanged

#### Scenario: Masked sentinel preserves the stored key

- **WHEN** a client sends `apiKey: "***"` for an existing provider
- **THEN** the stored key SHALL be preserved and the literal sentinel SHALL NOT be persisted

#### Scenario: Masked sentinel on an absent provider is not persisted

- **WHEN** a client sends `apiKey: "***"` for a provider not present in the file
- **THEN** the server SHALL NOT persist the literal `***` as the key

#### Scenario: Name is not editable in place

- **WHEN** the operator edits an existing custom endpoint
- **THEN** the name SHALL NOT be editable in that surface
- **AND** no write SHALL delete an entry in order to re-create it under another name

#### Scenario: Blank name in the path is rejected

- **WHEN** a client sends `PATCH /api/providers/%20`
- **THEN** the server SHALL reject the request
- **AND** SHALL NOT write the file

#### Scenario: Self-pointing base URL is rejected

- **WHEN** the submitted `baseUrl` points back at the dashboard's own proxy endpoint
- **THEN** the server SHALL reject the write on the same terms as the whole-map write

### Requirement: Single-provider delete endpoint

The server SHALL expose `DELETE /api/providers/:name`, removing the named entry from `~/.pi/agent/providers.json`. Deleting a name that is not present SHALL NOT be an error condition that leaves the file in a different state than deleting one that is — in both cases the post-condition is that the name is absent.

#### Scenario: Delete removes only the named provider

- **WHEN** the file holds `proxy` and `vllm` and a client sends `DELETE /api/providers/proxy`
- **THEN** `proxy` SHALL be absent
- **AND** `vllm` SHALL remain unchanged

#### Scenario: Delete of an absent provider

- **WHEN** a client deletes a name that is not in the file
- **THEN** the server SHALL report success and the remaining entries SHALL be unchanged

### Requirement: Writes preserve every non-provider key in the file

`providers.json` also carries the operator's role configuration (`roles`, `rolePresets`, `activePreset`) and MAY carry further top-level keys. A single-provider write SHALL preserve **every** top-level key other than the one it edits. A write that replaces the file with only its `providers` map SHALL NOT occur.

#### Scenario: Role configuration survives a provider write

- **WHEN** the file holds `roles`, `rolePresets`, and `activePreset` alongside `providers`, and a client sends `PATCH /api/providers/proxy`
- **THEN** `roles`, `rolePresets`, and `activePreset` SHALL be deep-equal to their pre-write values

#### Scenario: Role configuration survives a delete

- **WHEN** a client sends `DELETE /api/providers/proxy` on the same file
- **THEN** the non-provider keys SHALL be unchanged

### Requirement: Single-provider writes are atomic and do not interleave a read with a write

`PATCH` and `DELETE` SHALL write the file atomically (write-then-rename), and SHALL perform the read of the existing file and the write of the new content with no intervening asynchronous work, so two requests to the same server process cannot lose-update each other. Concurrency with a *different* process editing the same file is out of scope; the file carries no lock.

#### Scenario: Two concurrent single-provider writes both land

- **WHEN** two requests write different providers at the same time
- **THEN** both providers SHALL be present in the resulting file

#### Scenario: Interrupted write leaves valid content

- **WHEN** a write is interrupted
- **THEN** the file SHALL contain either the previous or the new content, never a partial document

### Requirement: Single-provider writes refresh models and notify sessions

After a successful `PATCH` or `DELETE`, the server SHALL refresh its model registry and broadcast `credentials_updated` to connected pi sessions, on the same terms as the whole-map write.

#### Scenario: Add notifies sessions

- **WHEN** a custom provider is created via `PATCH`
- **THEN** the server SHALL broadcast `credentials_updated`

#### Scenario: Delete notifies sessions

- **WHEN** a custom provider is removed via `DELETE`
- **THEN** the server SHALL broadcast `credentials_updated`

### Requirement: Single-provider writes preserve other providers' cached health

Cached provider health is a set keyed by provider name, and the retention operation prunes every key outside the set it is given. A `PATCH` SHALL therefore retain the health of **all** providers that remain in the file, and a `DELETE` SHALL drop only the deleted provider's entry. A single-provider write SHALL NOT clear another provider's health pill.

#### Scenario: Editing one provider does not clear another's pill

- **WHEN** `proxy` and `vllm` both have cached health and `proxy` is updated
- **THEN** `vllm`'s cached health SHALL be unchanged

#### Scenario: Deleting a provider drops only its own health

- **WHEN** `proxy` is deleted
- **THEN** its cached health SHALL be dropped
- **AND** `vllm`'s SHALL remain

### Requirement: Single-provider routes are tiered and manifest-bound

`PATCH /api/providers/:name` and `DELETE /api/providers/:name` SHALL each carry a route-tier entry at the same tier as the existing whole-map write, and SHALL each be bound in the MCP tool manifest or explicitly denylisted. An unlisted route is not rejected at runtime, so the binding is the enforcement.

#### Scenario: Both routes carry a tier

- **WHEN** the route tier table is read
- **THEN** it SHALL contain an entry for each of the two routes

#### Scenario: Both routes are manifest-bound or denylisted

- **WHEN** the manifest-completeness check runs over `/api/*`
- **THEN** it SHALL find each route bound or explicitly denylisted

### Requirement: The single-provider write does not block on the upstream probe

The whole-map write awaits an upstream probe per provider before responding. Because a single-provider write happens on every edit, `PATCH` SHALL respond without awaiting the probe: it SHALL probe only the provider it touched, and the client SHALL render a pending health state that reconciles from the cached health once the probe lands.

The probe SHALL be fully detached from the response: with an upstream that never answers, `PATCH` SHALL still respond at **p95 < 300 ms**. The client SHALL reconcile by issuing **one** health read approximately 2 s after the write response — not a poll loop, and not a wait on the probe.

#### Scenario: Response does not wait for the probe

- **WHEN** a provider is saved whose upstream accepts the connection and never responds
- **THEN** the write response SHALL arrive at p95 under 300 ms
- **AND** SHALL NOT be delayed by the probe timeout

#### Scenario: Only the touched provider is probed

- **WHEN** one provider of five is updated
- **THEN** exactly one upstream probe SHALL be issued

#### Scenario: The client learns the probe is pending and reconciles

- **WHEN** a single-provider write returns before its probe has landed
- **THEN** the written row SHALL render a pending health state
- **AND** the client SHALL perform exactly one health read about 2 s after the write response
- **AND** the row SHALL reconcile to the health that read returns
