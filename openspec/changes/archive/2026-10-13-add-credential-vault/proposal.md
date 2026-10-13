## Why

Keys for services, skills and plugins live in unrelated places today:
- three hand-rolled `.env` precedence chains (nano-banana, video-production, video-transcription);
- `system-one/auth.json`;
- bare `process.env` reads (deck3d, quota, document-converter, browser-plugin).

A further `connector-auth.json` is planned by `add-connector-layer`. One key, `GEMINI_API_KEY`, is read by five or more consumers and can sit in three files at once. Nothing can be managed, rotated or scoped centrally, and nothing reaches sessions on other machines connected to the dashboard.

This change is the foundation of a three-part split:
1. **`add-credential-vault`** (this change): the vault, static keys, delivery as environment variables.
2. **`add-vault-llm-delivery`**: LLM keys and OAuth (lease, proxy, pools, second accounts per provider).
3. **`absorb-service-secrets-into-vault`**: managed-service secrets move into the vault.

## What Changes

- **Credential vault** owned by the dashboard server, in `~/.pi/dashboard/vault.json` (owner-only, locked, atomic, corrupt-file safe). Entries are **accounts** of kind `key`, several per provider allowed. The schema reserves room for `oauth` accounts and `llm` bindings, which change 2 adds.
- **Env bindings** give an environment variable name a default `key` account. Names are validated against a deny list (`PATH`, `LD_*`, `NODE_*`, `GIT_*`, `PI_*`, proxy and CA variables, and similar).
- **Per-project grants**, default deny. A grant names a binding for a project, keyed by normalised git remote or by device and exact directory. It may choose a different account for that project, so project A can use the "personal" Gemini key and project B the "work" one.
- **Checkout confirmation.** A repository grant is honoured on a device and directory only after the user confirms that checkout once. This stops a malicious clone from claiming a granted `origin`.
- **Delivery to sessions** on the hub and on paired devices, through the bridge extension, using public pi extension APIs only:
  - Values are set in the session's `process.env` and are visible from the next shell command. Consumers that read env first need no change.
  - Delivery writes no files on the session machine.
  - Rotation and revocation are pushed, and are reconciled in full on every reconnect and every session start. A downgraded hub causes full withdrawal. They survive an extension reload and never touch a value the user overwrote. Processes already running keep their old environment.
  - Values are withdrawn after an offline grace period (default 24 h) without hub contact.
  - Nested pi processes (subagents, flows) recognise inherited values by name, so those values are redacted there too.
- **Local values win.** A variable present before delivery is never replaced, and the binding is reported as `local-override`.
- **Redaction.** Exact occurrences of delivered values are masked in all of these:
  - tool output, completion events and streamed output;
  - user `!` commands;
  - extension event payloads;
  - full-output files, once the command completes.

  pi 1.0 writes the full-output file in plaintext while a command runs. pi 1.1 writes it with mode `0600`.
- **Settings UI**:
  - add, import, rotate and revoke keys;
  - manage bindings and grants;
  - confirm checkouts;
  - approve plugin declarations;
  - show per-session binding state.

  Every vault route needs `operate` authority or local trust.
- **Import**, from known skill and `system-one` locations or from a browser upload. The server never reads a path the client supplies. Sources are never modified.
- **Plugins** can read the bindings their manifest declares, once the user approves the declaration.
- **Sibling re-scoping** (task): `add-connector-layer` uses vault `key` accounts instead of `connector-auth.json`.

## Capabilities

### New Capabilities
- `credential-vault`: covers
  - account storage (`key` kind) and corrupt-file handling;
  - management surfaces and their authority rule;
  - env bindings and the env-name deny list;
  - per-project grants and checkout confirmation;
  - rotation and revocation;
  - non-destructive import;
  - declared-binding plugin reads.
- `credential-delivery`: covers
  - trusted, granted env delivery, including nested pi sessions;
  - the local-precedence rule;
  - rotation, revocation and reconnect reconciliation;
  - redaction of exact occurrences;
  - bounded retention while the hub is unreachable;
  - clean disable;
  - observable binding state.

### Modified Capabilities
- `catch-all-event-forwarding`: adds a fourth, value-scoped forwarding exception. While a session holds vault values, the bridge masks them in forwarded payloads and may delay, but never drop, the trailing characters of a stream. Every other spec-collateral candidate is dispositioned in design.md D8.

## Impact

- **Server** (`packages/server/src/`): vault store, routes and allowlist; delivery push over the bridge WebSocket.
- **Bridge** (`packages/extension/src/`): delivery module (env set/unset, a delivery registry on `process`), redaction in `tool_result`, `user_bash`, spill files and the event forwarder; cleanup on disable or unload.
- **Client** (`packages/client/src/components/settings/`): vault, bindings, allowlist and session-binding views.
- **Shared** (`packages/shared/src/protocol.ts`): delivery, push and status messages.
- **Plugin runtime**: declared-binding reads.
- **Consumers that read env first** (nano-banana, video-*, deck3d, system-one): no code change. Delivered env outranks their `.env` and file fallbacks. Grants decide which vault values a project gets; an ungranted project still reads its own `.env` files.
- **Quota** prefers pi's credential and falls back to env.
- **Document-converter** forwards only the names in its `passEnv` list.
- **Security**:
  - Values reach other machines only over TLS to authenticated paired devices, and only into confirmed checkouts.
  - Redaction is exact-match only.
  - In-process plugins and other pi extensions remain trusted code.
- **pi version**: the env and redaction seams were checked on pi 1.1.0, but the repo pins 1.0.0. A task re-verifies them on 1.0.0.
- **Compatibility and rollback**: additive. With no accounts, or with delivery disabled, behaviour is identical to today.

## Discipline Skills

- `security-hardening`: values at rest, values over the bridge to paired devices, env deny list, redaction, allowlist and route authority.
- `doubt-driven-review`: before fixing the vault schema, which later changes extend.
- `observability-instrumentation`: delivery, rotation, revocation and local-override events, never logging values.
- `systematic-debugging`: expected during the project-key, redaction-hook and pi-1.0 spikes.
