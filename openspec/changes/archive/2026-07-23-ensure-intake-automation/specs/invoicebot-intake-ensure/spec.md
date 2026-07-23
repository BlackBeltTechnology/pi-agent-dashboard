## ADDED Requirements

### Requirement: Ensure-automation port method
The `InvoiceEngine` port SHALL expose
`ensureAutomation(cwd: string): Promise<{ automation: string[] }>`, keyed by the
request `cwd` like the other port methods. `RealInvoiceEngine` SHALL delegate to
the engine facade's `ensureIntakeAutomation(cwd)`; `FakeInvoiceEngine` SHALL be a
no-op returning `{ automation: [] }` and SHALL perform no filesystem write.

#### Scenario: Real binding delegates to the facade
- **WHEN** `RealInvoiceEngine.ensureAutomation(cwd)` is called
- **THEN** it invokes the facade's `ensureIntakeAutomation(cwd)` and returns its `{ automation }` result verbatim

#### Scenario: Fake binding is an inert no-op
- **WHEN** `FakeInvoiceEngine.ensureAutomation(cwd)` is called
- **THEN** it resolves to `{ automation: [] }`
- **AND** writes nothing to the filesystem

### Requirement: Ensure on first touch of a workspace
Every workspace-touching route SHALL call `engine.ensureAutomation(cwd)` with the
request `cwd`, after `badCwd(cwd)` passes and before the handler dispatches or
returns. The covered routes are `POST /query`, `POST /review`, `POST /setup`,
`POST /rules`, `POST /automation`, `GET /automation`, and `POST /upload`.

#### Scenario: A workspace-touching request ensures the scaffold
- **WHEN** a valid request reaches any of the covered routes with a valid `cwd`
- **THEN** the handler calls `engine.ensureAutomation(cwd)` with that `cwd` before producing its response

#### Scenario: Ensure runs only after cwd validation
- **WHEN** a request arrives with an invalid `cwd`
- **THEN** the route returns `400` from `badCwd` and does NOT call `engine.ensureAutomation`

#### Scenario: Ensure does not change the handler response
- **WHEN** a covered route completes with the ensure call in place
- **THEN** the response body and status are identical to the same request without the ensure call (the ensure is a side effect only)

### Requirement: Blob route is excluded
`GET /api/plugins/invoicebot/blob` SHALL NOT call `engine.ensureAutomation`. It is
a read of an already-retained original with no workspace-configuration semantics
and a latency-sensitive ranged path.

#### Scenario: Blob request performs no ensure
- **WHEN** a client GETs `/blob` (full or ranged)
- **THEN** the handler does NOT call `engine.ensureAutomation`
- **AND** blob delivery behavior (200 / 206 / 416 / 4xx) is unchanged
