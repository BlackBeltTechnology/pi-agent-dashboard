## ADDED Requirements

### Requirement: Runtime plugin loading fits the baseline policy

Runtime plugin client loading SHALL work under the baseline policy in `enforce` mode, without changing the baseline policy's directives. The inline import map relies on `script-src 'unsafe-inline'`. Plugin modules, stylesheets and host shims load from same-origin URLs, which `'self'` covers. Runtime plugin loading SHALL NOT add `blob:` or `data:` to `script-src`.

#### Scenario: Enforce mode renders a runtime claim
- **WHEN** `PI_DASHBOARD_CSP=enforce` and a trusted runtime plugin's claim renders
- **THEN** the claim SHALL render and its styles SHALL apply with zero CSP violations

#### Scenario: Blob import stays blocked
- **WHEN** code attempts `import(URL.createObjectURL(blob))` under `enforce`
- **THEN** the browser SHALL block it, and the baseline policy SHALL NOT be relaxed to allow it

### Requirement: Tightening script-src keeps the import map working

If the baseline replaces `'unsafe-inline'` in `script-src` with nonces or hashes, the same change SHALL stamp the nonce on (or include the hash of) the server-injected import-map tag.

#### Scenario: Nonce-based policy
- **WHEN** the baseline policy switches to a per-response script nonce
- **THEN** the import-map `<script type="importmap">` in every served `index.html` SHALL carry that nonce, and runtime claims SHALL still render under `enforce`
