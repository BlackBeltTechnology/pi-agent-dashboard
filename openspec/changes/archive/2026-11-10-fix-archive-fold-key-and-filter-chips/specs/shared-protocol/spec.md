## MODIFIED Requirements

### Requirement: Sessions snapshot message (server to browser)

The server SHALL define a `SessionsSnapshotMessage` in the browser protocol with shape:

```ts
interface SessionsSnapshotMessage {
  type: "sessions_snapshot";
  sessions: DashboardSession[];
  orders: Record<string, string[]>;      // cwd → ordered session ids (windowed)
  endedTotals: Record<string, number>;   // session group key → count of ended sessions regardless of window
  archivedCountByCwd: Record<string, number>; // archive index key → archived session count
  pathKeyPlatform?: "linux" | "darwin" | "win32"; // platform whose path normalisation produced the archive keys
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

#### Scenario: Snapshot names the archive key platform
- **WHEN** the server constructs a snapshot for a browser connect
- **THEN** `pathKeyPlatform` SHALL equal the platform the archive index normalises its keys with
- **AND** a consumer that ignores the field SHALL still parse the message
