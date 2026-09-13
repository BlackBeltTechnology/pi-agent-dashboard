## MODIFIED Requirements

### Requirement: Sessions snapshot message (server to browser)

The server SHALL define a `SessionsSnapshotMessage` in the browser protocol with shape:

```ts
interface SessionsSnapshotMessage {
  type: "sessions_snapshot";
  sessions: DashboardSession[];
  orders: Record<string, string[]>;      // cwd → ordered session ids (windowed)
  endedTotals: Record<string, number>;   // session group key → count of ended sessions regardless of window
}
```

This message SHALL be a member of the `ServerToBrowserMessage` union.

#### Scenario: Snapshot type is recognized
- **WHEN** a `ServerToBrowserMessage` with `type: "sessions_snapshot"` is received by a TypeScript-typed consumer
- **THEN** the discriminated union SHALL narrow to `SessionsSnapshotMessage` exposing `sessions`, `orders`, and `endedTotals` fields

#### Scenario: Snapshot carries every known session
- **WHEN** the server constructs a snapshot for a browser connect
- **THEN** `sessions` SHALL contain every non-ended entry returned by `sessionManager.listAll()` at construction time
- **AND** `sessions` SHALL contain each cwd's ended entries that fall inside the snapshot window, and no others
- **AND** `orders` SHALL contain, for every cwd whose persisted order is non-empty, that order restricted to ids present in `sessions`
- **AND** `endedTotals[cwd]` SHALL equal the number of ended sessions for that cwd regardless of window, for every cwd with at least one ended session
- **AND** no row in `sessions` SHALL carry `notifyLog`

## ADDED Requirements

### Requirement: OpenSpec get request and result messages

The protocol SHALL define a browser-to-server `OpenSpecGetMessage` and a server-to-browser `OpenSpecGetResultMessage`:

```ts
interface OpenSpecGetMessage {
  type: "openspec_get";
  requestId: string;
  cwd: string;
}

interface OpenSpecGetResultMessage {
  type: "openspec_get_result";
  requestId: string;
  cwd: string;
  data: OpenSpecData;   // same payload shape as openspec_update
  final: boolean;       // false = placeholder, a final reply follows; true = last reply for this requestId
}
```

`OpenSpecGetMessage` SHALL be a member of `BrowserToServerMessage`; `OpenSpecGetResultMessage` SHALL be a member of `ServerToBrowserMessage`.

#### Scenario: Types narrow in the unions
- **WHEN** a typed consumer switches on `type: "openspec_get"` or `type: "openspec_get_result"`
- **THEN** the union SHALL narrow to the corresponding interface exposing `requestId` and `cwd` (and `data`, `final` on the result)

#### Scenario: Result data is an OpenSpecData
- **WHEN** an `openspec_get_result` is received
- **THEN** its `data` SHALL be assignable to the same `OpenSpecData` type carried by `openspec_update`

### Requirement: Sessions page request and result messages

The protocol SHALL define a browser-to-server `SessionsPageMessage` and a server-to-browser `SessionsPageResultMessage`:

```ts
interface SessionsPageMessage {
  type: "sessions_page";
  cwd: string;           // session group key (same key space as `orders`)
  offset: number;        // count of non-window ended sessions the client already holds for cwd (0 = first page)
}

interface SessionsPageResultMessage {
  type: "sessions_page_result";
  cwd: string;
  sessions: DashboardSession[];
  order: string[];       // ids of `sessions` in the cwd's ended sequence order
  hasMore: boolean;      // true when further non-window ended sessions remain beyond this page
}
```

`SessionsPageMessage` SHALL be a member of `BrowserToServerMessage`; `SessionsPageResultMessage` SHALL be a member of `ServerToBrowserMessage`.

#### Scenario: Types narrow in the unions
- **WHEN** a typed consumer switches on `type: "sessions_page"` or `type: "sessions_page_result"`
- **THEN** the union SHALL narrow to the corresponding interface

#### Scenario: Result order references only its own sessions
- **WHEN** a `sessions_page_result` is constructed by the server
- **THEN** every id in `order` SHALL be the id of an entry in `sessions`
