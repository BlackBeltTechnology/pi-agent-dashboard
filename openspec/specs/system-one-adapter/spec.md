# system-one-adapter Specification

## Purpose
TBD - created by archiving change add-system-one-registry. Update Purpose after archive.

## Requirements

### Requirement: Single predict contract
The library `packages/system-one` SHALL expose `predict({ consumer, state, questions, signal?, project? })`, returning a `PredictResult`. `consumer` SHALL be a declaration `{ id, label?, failurePolicy, requires?, fixtures? }`, where `fixtures` is an absolute path to a JSON array of `{ state, questions, expected }` cases. `project`, when given, is `{ cwd, trusted }` (see system-one-config). `consumer.id` SHALL match `^[a-z0-9][a-z0-9:._-]{0,127}$`. A call with an invalid id SHALL return `ok: false`, `reason: "error"`, without any network request. `questions` SHALL be a map from question id to one of:
- `{ type: "choice", instructions, criteria: Record<string, string> }`
- `{ type: "score", instructions, criteria: string[] }` (ordered levels)
- `{ type: "noul", instructions, criteria?: { true: string; false: string } }`

A `PredictResult` SHALL be either:
- `{ ok: true, answers, backendId, model, mode, thresholds, latencyMs }`, where `thresholds` is the calibration record's map, or `{}` when none applies; or
- `{ ok: false, reason, policy }`, where `reason` ∈ `no-backend | capability | off-machine | timeout | error`.

Every question in the request SHALL have an answer, and each answer SHALL be constrained to the supplied options:
- `choice`: `choice` ∈ keys of `criteria`, plus `probabilities` and `confidence`;
- `score`: `score` in `[0, levels-1]`, plus `probabilities` and `confidence`;
- `noul`: `noul` in `[0, 1]`.

A backend response violating this shape SHALL be treated as an `error` for that backend.

#### Scenario: Well-formed answer
- **WHEN** a consumer asks one `choice` over `{a, b}` and one `noul`
- **THEN** the result has `ok: true`, `answers.<choiceId>.choice` ∈ `{a, b}` and `answers.<noulId>.noul` in `[0, 1]`

#### Scenario: Backend returns an undeclared option
- **WHEN** an `http` backend answers a `choice` with a key absent from `criteria`
- **THEN** that backend attempt is recorded as `error` and the next backend in the chain is tried

### Requirement: Backend kinds
The adapter SHALL support two backend kinds:
- `http`: `POST <url>` with the TypeSafe `/v1/systemone` request body (`model`, `state`, `questions`) and an `Authorization: Bearer <key>` header when a key is resolved.
- `llm`: calls an injected `LlmCaller` with `{ role, state, questions, signal }`. The caller returns `{ answers, model }` and exposes `isLocal(role): boolean`. `isLocal` SHALL be `true` only when the resolved provider runs inference on this machine. A loopback proxy that forwards to a remote provider, including the dashboard's own model proxy, SHALL report `false`. Probabilities are used where the model provides them; otherwise the picked option gets `1.0`. The adapter SHALL enforce the `llm` timeout with its own timer and abort signal, whether or not the caller honours the signal.

The `llm` kind SHALL NOT be used unless the caller supplies an `LlmCaller`. Without one, that chain entry SHALL be skipped with reason `no-backend`.

#### Scenario: Extension caller without LLM access
- **WHEN** the chain is `["laya-local", "llm"]`, `laya-local` is unreachable, and the caller passed no `LlmCaller`
- **THEN** the result is `ok: false` with `reason: "no-backend"` and the consumer's declared `policy`

### Requirement: Ordered fallback chain
The adapter SHALL resolve the chain for a consumer in this order:
1. the consumer override in the active preset;
2. the active preset's default chain;
3. an empty chain.

It SHALL try entries in order. It SHALL move to the next entry on every per-entry failure and skip: `timeout`, transport error, redirect, malformed response (`error`), `capability`, `off-machine`, and `no-backend`. `no-backend` covers an `llm` entry without an `LlmCaller`, and a `managed` backend with no port assigned yet. It SHALL return the first success. When every entry fails, it SHALL return `ok: false` with the last failure reason and the consumer's failure policy. The adapter SHALL NOT retry the same backend within one `predict` call.

#### Scenario: Primary times out
- **WHEN** the chain is `["jev", "llm"]` and `jev` exceeds its timeout
- **THEN** `llm` is tried and its answer is returned with `backendId: "llm"`

#### Scenario: No config at all
- **WHEN** no `system-one.json` exists
- **THEN** `predict` returns `ok: false`, `reason: "no-backend"`, without any network request

### Requirement: Failure policy is declared by the consumer
Each consumer declaration SHALL carry `failurePolicy` ∈ `fail-open | fail-closed | deterministic`. The adapter SHALL return `consumer.failurePolicy` unchanged on every `ok: false` result. The adapter SHALL NOT itself allow, block or substitute an answer. Applying the policy is the consumer's job.

#### Scenario: Gate consumer when all backends fail
- **WHEN** a consumer declared `fail-open` gets `ok: false`
- **THEN** the result carries `policy: "fail-open"`

### Requirement: Consumers self-register
On each `predict` call whose declaration differs from the stored one, the library SHALL write the declaration, together with `lastSeen`, to `~/.pi/agent/system-one/consumers/<sha256(id)>.json` (0600; temp file + rename). There is one file per consumer, so concurrent processes never overwrite each other's consumers. It SHALL do this at most once per `id` per process for an unchanged declaration. A failed registry write SHALL NOT fail `predict`.

#### Scenario: First call registers
- **WHEN** a consumer `ctx:is_lesson` calls `predict` for the first time
- **THEN** a file under `consumers/` contains `ctx:is_lesson` with its `failurePolicy`

### Requirement: Capability check per request
Before sending to a backend, the adapter SHALL compare the request with the backend's capability record and skip the backend (reason `capability`) when:
- the estimated state tokens (characters ÷ 4) plus the longest question exceed `maxContextTokens`;
- any `choice` has more options than `maxOptions`; or
- a question's primitive is not in `primitives`.

A capability value of `unknown` SHALL NOT cause a skip. Token estimates use characters ÷ 4; this under-counts CJK text, which is an accepted approximation. Language is not checked per request; it is a settings-UI filter only.

#### Scenario: Large state against Laya
- **WHEN** a request estimates 3,000 tokens and the chain is `["laya-local", "jev"]` with `laya-local.maxContextTokens = 512`
- **THEN** `laya-local` is skipped with `capability` and `jev` answers

### Requirement: Off-machine enforcement
A backend SHALL be classified as `offMachine` when either:
- it is `http` and its URL host is not a loopback address (`localhost`, `127.0.0.0/8`, `::1`); or
- it is `llm` and `LlmCaller.isLocal(role)` is not `true`.

A loopback `http` backend is classified on-machine on the user's declaration; the settings UI labels it "loopback (user-declared)".

When the effective config has `allowOffMachine: false`, the adapter SHALL skip every `offMachine` backend with reason `off-machine`, before any request bytes are sent. The default when the key is absent SHALL be `false`.

`http` backends SHALL only accept `http:` and `https:` URLs. Requests SHALL be sent with redirects disabled (`redirect: "error"`), and a redirect response SHALL count as `error`. This stops a loopback URL from forwarding the state to a remote host.

#### Scenario: Switch off blocks hosted Jev
- **WHEN** `allowOffMachine` is `false` and the chain is `["jev"]`
- **THEN** no request is sent to `api.typesafe.ai`
- **AND** the result is `ok: false` with `reason: "off-machine"`

#### Scenario: Loopback redirect to remote
- **WHEN** a loopback backend answers with `302 Location: https://remote.example/`
- **THEN** no request reaches `remote.example`, and the attempt is recorded as `error`

#### Scenario: LLM behind the loopback model proxy
- **WHEN** `allowOffMachine` is `false` and the chain's `llm` role resolves through the dashboard model proxy to a cloud provider
- **THEN** `isLocal` is `false`, and the entry is skipped with `off-machine`

#### Scenario: Local managed backend allowed
- **WHEN** `allowOffMachine` is `false` and the backend URL is `http://127.0.0.1:18431/v1/systemone`
- **THEN** the request is sent

### Requirement: Shadow and enforce mode
Every `ok: true` result SHALL carry `mode` ∈ `shadow | enforce`. `mode` SHALL be `enforce` only when a calibration record exists for the pair (answering `backendId`, `consumerId`) with `mode: "enforce"`. Otherwise it SHALL be `shadow`. Consumers SHALL treat a `shadow` answer as advisory only. Enforcement and thresholds live in consumer code and read `thresholds` from the same calibration record, which the result SHALL include.

#### Scenario: Fallback backend uncalibrated
- **WHEN** a consumer is calibrated `enforce` on `jev` but `jev` fails and `llm` answers
- **THEN** the result has `backendId: "llm"` and `mode: "shadow"`

### Requirement: Timeouts and overhead budget
Each backend attempt SHALL have a timeout: the backend's `timeoutMs`, else 2,000 ms for `http` and 15,000 ms for `llm`, capped by the caller's `signal`. Adapter work outside the network attempt (config read from the in-memory cache, capability check, logging) SHALL add at most 5 ms at p95 per `predict` call. The config SHALL be re-read only when the file's mtime changes.

#### Scenario: Caller abort
- **WHEN** the caller's `signal` aborts during an attempt
- **THEN** no further chain entries are tried and the result is `ok: false` with `reason: "timeout"`

### Requirement: Decision log without state text
Every `predict` call SHALL append one JSON line to `~/.pi/agent/system-one/decisions/<YYYY-MM-DD>.<pid>.jsonl` (file mode 0600). There is one file per process, so concurrent sessions never interleave lines. The line SHALL contain:
- `consumerId`;
- per-attempt `{ backendId, outcome, latencyMs }`;
- the answering `model` string as returned by the backend;
- `mode`;
- the full answer distributions (`probabilities` / `noul` / `score`);
- a SHA-256 of the serialized state.

It SHALL NOT contain the state, the instructions text, or any key. Log write failures SHALL NOT fail `predict`. Files older than 30 days SHALL be deleted on library load.

#### Scenario: Log contains no state
- **WHEN** a consumer sends state containing the string `SECRET-MARKER`
- **THEN** no decision log line contains `SECRET-MARKER`
