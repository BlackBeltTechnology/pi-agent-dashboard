## ADDED Requirements

### Requirement: Deny-first in-session tool guard

The web-chat extension SHALL block (`{ block: true }`) every tool call whose name is not in the allowlist projected by the plugin; a missing, malformed or empty projected policy SHALL block every tool call. Blocked calls SHALL be logged by tool name only.

#### Scenario: Undeclared tool blocked
- **WHEN** the model calls `bash` or `read`
- **THEN** the call SHALL be blocked and logged as `bash` / `read`

#### Scenario: Garbage policy denies all
- **WHEN** the projected policy is not valid JSON
- **THEN** every tool call, including `kb_search`, SHALL be blocked

### Requirement: `kb_search` over a read-only docs directory

`kb_search({ query })` SHALL be executed by the plugin server (the extension forwards the call over the plugin-message lane) against an index of `.md` and `.txt` files under the operator-configured absolute `kbDir`, built at plugin start and rebuilt on change (debounced 10 seconds, never two rebuilds concurrently), capped at 10 000 files and 50 MB (files beyond the cap are skipped and logged). It SHALL return at most 5 snippets of at most 2000 characters each, labelled with the document title and never with a filesystem path, SHALL NOT follow symlinks out of `kbDir` and SHALL NOT write anything. An invalid `kbDir` closes the serving gate (see `web-chat-customer-auth`); when no `kbDir` is configured, `kb_search` SHALL NOT be in the projected allowlist.

#### Scenario: Results carry no paths
- **WHEN** `kb_search` returns snippets
- **THEN** no snippet or label SHALL contain an absolute path

#### Scenario: Symlink escape ignored
- **WHEN** `kbDir` contains a symlink to `/etc`
- **THEN** no content from outside `kbDir` SHALL be indexed or returned

### Requirement: Declared read-only business API tools

Each configured API tool SHALL expose a tool with the declared name, description and parameters; the declarations reach the extension as one JSON string in its projected config, and no secret SHALL be projected into the session. A call SHALL be executed by the plugin server, not inside the pi process: the URL SHALL be built from the declared `https` template whose host exactly equals (case-insensitive, no suffix matching) an entry of `allowedApiHosts`; a template that does not contain `{customerSub}` SHALL be rejected at config load unless the declaration sets `unscoped: true`, and a template with any placeholder in its scheme, host or port SHALL be rejected at config load; after substitution the request URL's host SHALL again be checked for exact equality with an `allowedApiHosts` entry before any secret header is attached; model-supplied parameters SHALL be validated against their declared pattern and URL-encoded; the placeholder `{customerSub}` SHALL be filled only from the authenticated customer's subject, percent-encoded as a single path segment or query value; header secrets SHALL be read from declared vault bindings; the request SHALL be `GET`, SHALL NOT follow redirects, SHALL time out after 10 seconds, and its response SHALL be truncated to 64 KiB of text or JSON. Any validation or transport failure SHALL return a generic error to the model.

#### Scenario: Parameter pattern enforced
- **WHEN** a tool declares `orderId` with pattern `^[0-9]{1,12}$` and the model passes `1/../admin`
- **THEN** no request SHALL be made and the model SHALL receive a generic error

#### Scenario: Customer scoping cannot be overridden
- **WHEN** a template contains `{customerSub}` and the model passes a parameter named `customerSub`
- **THEN** the URL SHALL contain the authenticated customer's subject, not the model's value

#### Scenario: Unscoped template rejected at load
- **WHEN** a declared template lacks `{customerSub}` and does not set `unscoped: true`
- **THEN** the tool SHALL NOT be registered and the rejection SHALL be logged

#### Scenario: Placeholder in host position rejected
- **WHEN** a declared template is `https://{customerSub}.shop.example/orders`
- **THEN** the tool SHALL be rejected at config load

#### Scenario: Host suffix does not match
- **WHEN** `allowedApiHosts` is `["api.shop.example"]` and a template targets `api.shop.example.evil.test`
- **THEN** the tool SHALL be rejected at config load

#### Scenario: Redirect not followed
- **WHEN** the API answers `302` to another host
- **THEN** the redirect SHALL NOT be followed and the model SHALL receive a generic error

### Requirement: `escalate_to_human`

`escalate_to_human({ reason })` SHALL be forwarded to the plugin server, which truncates `reason` to 500 characters, creates an escalation for the conversation (see `web-chat-escalation`) and returns a fixed acknowledgement text to the model; a second call while an escalation of that conversation is open SHALL NOT create another.

#### Scenario: One open escalation per conversation
- **WHEN** the model calls `escalate_to_human` twice in one conversation
- **THEN** exactly one open escalation SHALL exist
