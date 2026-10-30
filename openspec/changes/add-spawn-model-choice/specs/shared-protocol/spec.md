## MODIFIED Requirements

### Requirement: `spawn_result` echoes `requestId` and may include `pid`
The `SpawnResultBrowserMessage` (server → browser) SHALL include an optional `requestId?: string`, an optional `pid?: number` and an optional `choiceWarning?: string` field. When the input `spawn_session` carried a `requestId`, the server SHALL echo it. The `pid` SHALL be included when the spawn produced a tracked PID (headless strategy). `choiceWarning` SHALL be included only when a model or thinking choice of the input was dropped.

```ts
export interface SpawnResultBrowserMessage {
  type: "spawn_result";
  cwd: string;
  success: boolean;
  message: string;
  requestId?: string;
  pid?: number;           // informational only
  choiceWarning?: string; // NEW: dropped model/thinking choice
}
```

#### Scenario: TypeScript type includes requestId and pid
- **WHEN** `SpawnResultBrowserMessage` is referenced in TypeScript
- **THEN** `requestId: string | undefined`, `pid: number | undefined` and `choiceWarning: string | undefined` SHALL be allowed

#### Scenario: requestId echoed when input had one
- **WHEN** the server processes `spawn_session { cwd: "/p", requestId: "rq_1" }` and emits a result
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_1"`

#### Scenario: requestId omitted when input lacked one
- **WHEN** the server processes a legacy `spawn_session` without `requestId`
- **THEN** the emitted `spawn_result` SHALL NOT include a `requestId` field

#### Scenario: choiceWarning omitted when nothing was dropped
- **WHEN** the server processes `spawn_session { cwd: "/p" }`
- **THEN** the emitted `spawn_result` SHALL NOT include a `choiceWarning` field
