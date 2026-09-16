## Why

`list_sessions` returns `ctx.sessionManager.listAll()` — the entire store, in one
response, with no filter, limit or cursor. Measured live: **539 sessions, 599 KB
of JSON** for a call whose useful answer was the **10 non-ended rows (17.7 KB)**.
That payload is pure context burn for an LLM caller and grows unbounded with the
store; the 1 MiB `MCP_BODY_LIMIT_BYTES` cap is on the *request*, so nothing
bounds this response at all.

## What Changes

- `list_sessions` gains optional arguments: **filters** (`status`, `cwd`,
  `since`), a **`limit`** with a server-side default and hard maximum, and a
  **`cursor`** for stable forward paging.
- Responses become an envelope carrying the page plus `nextCursor` and the
  total match count, so a caller can tell "no more" from "truncated" — an
  unmarked truncation is worse than a large payload.
- The default (no arguments) call is **BREAKING** by intent: it returns a bounded
  first page instead of the whole store. The tool's `inputSchema` and description
  advertise the bound so a client is never surprised by a silent cut.
- `status` accepts **multiple values**, so "what is running right now" is one
  call (`["active","idle","streaming"]`) rather than three.
- Argument validation becomes **strict**: a wrong-typed value, a numeric string,
  an out-of-range `limit` and an **unknown argument name** are each rejected with
  `-32602`. Nothing is coerced or silently ignored.
- Paging is specified as stable under concurrent mutation: a session created,
  ended **or removed** mid-walk SHALL NOT duplicate or skip an unrelated row.
- Ordering follows the repo's existing recency convention
  (`endedAt ?? lastActivityAt ?? startedAt`, `id` tiebreak); `hidden` worker
  sessions are excluded by default, matching the UI.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-mcp-server`: `Requirement: Tool surface is a guarded allowlist over
  the plugin server context` is extended with bounded, filterable, cursor-paged
  `list_sessions` results and strict argument validation.

## Impact

- `packages/mcp-server-plugin/src/server/tools.ts` — `list_sessions` `inputSchema`
  and description. **`McpToolDef.inputSchema.properties` is currently typed
  `Record<string, { type: string; description: string }>` and must be widened to
  carry `enum`, `minimum`, `maximum` and array item types.**
- `packages/mcp-server-plugin/src/server/index.ts` — the `list_sessions` handler
  (currently a one-liner over `listAll()`).
- `packages/mcp-server-plugin/src/server/dispatch.ts` — argument validation
  currently only checks `required` string args; optional typed args (numbers,
  enums, arrays) and unknown-argument rejection need a validation path that
  reports `-32602`, not a coerced value.
- `packages/server/src/session/memory-session-manager.ts` — **read-only.**
  `listAll()` is the data source; no change is required there.
- `packages/server/src/session/session-archive.ts` — read-only, but its
  `sessionManager.remove(id)` call at line 270 is the mid-walk **removal** the
  paging stability requirement must tolerate.
- Existing `mcp-server-plugin` tests pin the current `{ sessions }` shape and
  will need updating; no production in-repo consumer depends on the unbounded
  response. (`command-handler.ts` `list_sessions` is a *different* surface — the
  pi SDK tool — and is untouched.)

## Non-Goals

- Reshaping the per-session row. `notifyLog` (69 KB) and `sessionFile` (70 KB)
  dominate the payload, but trimming them is a separate change; the default
  limit is set so the page is acceptable without it.
- A general query language. Three concrete filters, no expression syntax.
- Backwards compatibility with the unbounded default — the bound is the point.

## Investigated and rejected — duplicate session ids

An earlier draft asserted that `list_sessions` emitted **two rows sharing the id
`01a096c7`**, and scoped a root-cause hunt plus a uniqueness guarantee around it.
**This was a measurement artifact and is not a real defect.** Recorded here so it
is not re-raised:

- The live store has **539 rows and zero duplicate full session ids**.
- It has **6 duplicate 8-character id *prefixes*** — including `01a096c7`, which
  resolves to two genuinely different sessions:
  `01a096c7-b02a-7305-…` and `01a096c7-b122-7316-…`.
- Session ids are UUIDv7: the leading hex digits encode the timestamp, so any two
  sessions started in the same ~65-second window share an 8-char prefix. The
  observation came from a display path that truncates via `id.slice(0, 8)` (used
  throughout this repo's session tooling).
- Structurally, a duplicate is impossible: `MemorySessionManager` stores sessions
  in a `Map<string, DashboardSession>` keyed by id, and both `sessions.set()`
  call sites key on the row's own id.

Consequently there is no uniqueness requirement, no root-cause task and no
tool-level assertion in this change. (A *separate* pre-existing concern — one
logical session appearing under both a v4 agentId and a v7 session id, i.e. two
**different** ids — is out of scope here and would not be caught by an
id-uniqueness check anyway.)

## Discipline Skills

- `performance-optimization` — the change exists because of a measured 599 KB
  response; the bound must be validated against the real store, not a fixture.
- `review-code` — non-trivial change to a public tool contract.
