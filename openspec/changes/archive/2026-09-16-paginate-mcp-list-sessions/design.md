## Context

See proposal.md — Why. Design-relevant current state, measured live against the
running dashboard (539 rows):

- `list_sessions` is `async () => ({ sessions: ctx.sessionManager.listAll() })`
  (`packages/mcp-server-plugin/src/server/index.ts:76`); `listAll()` is
  `Array.from(sessions.values())` (`packages/server/src/session/memory-session-manager.ts:432`).
- One call returned **539 rows / 599 KB**, of which **529 were `ended`** (5
  `active`, 5 `streaming`, 0 `idle`). Each row carries ~25 fields.
- Payload weight is concentrated in two fields: `notifyLog` (69 KB total) and
  `sessionFile` (70 KB total); the largest single row is 8.7 KB. `listAll()`
  does **not** strip `notifyLog` — only `buildSnapshot` does, via the existing
  `stripNotifyLog` helper (`memory-session-manager.ts:38`, used at `:274`).
- `dispatch.ts` argument validation only checks that each `inputSchema.required`
  entry is a non-empty **string**. There is no path today that validates an
  optional argument, a number, an enum, or an unknown argument name — a `limit`
  of `"abc"` would reach the handler unchallenged, and a misspelled `statuss`
  would be silently ignored despite `additionalProperties: false` being declared.
- `McpToolDef.inputSchema.properties` is typed
  `Record<string, { type: string; description: string }>` (`tools.ts:110`) — it
  cannot express `enum`, `minimum`, `maximum` or array item types today.
- `MCP_BODY_LIMIT_BYTES` (1 MiB) bounds the **request**. Nothing bounds a response.
- `sessionManager.remove(id)` is called during normal operation by the archive
  sweeper (`session-archive.ts:270`), so rows **disappear** mid-walk, not just
  appear.

## Goals / Non-Goals

**Goals:**
- A default call returns a small, useful page and says whether more exist.
- The common LLM query ("what is running right now") is answerable in **one**
  small call via filters, not by fetching everything and filtering client-side.

**Non-Goals:**
- Reshaping the per-session row (see proposal Non-Goals; the default limit is
  tuned so this is not needed to hit an acceptable page size).
- A general query language. Three concrete filters, no expression syntax.
- Backwards compatibility with the unbounded default — the bound is the point.
- Any duplicate-session-id handling — see proposal *Investigated and rejected*.

## Decisions

### D1 — Bound the default, do not merely offer an opt-in limit

An optional `limit` that defaults to "everything" leaves the failure mode exactly
where it is for every caller that does not know to pass it — which is every LLM
seeing the tool for the first time. Default limit **25**, hard maximum **200**.
Both are advertised in the tool description and `inputSchema`, so a client learns
the bound from `tools/list` rather than by being truncated.

**25, not 50, is measured rather than guessed.** Against the live store, an
envelope page costs 51 KB at 25 rows, 85 KB at 50 rows, and 244 KB at 200. Since
row reshaping is a non-goal, the default limit is the only lever that keeps the
common call near ~50 KB, so it is set at 25.

### D2 — Envelope response, not a bare array

`{ sessions, nextCursor, total }`. `total` is the count **after filtering**, so a
caller can tell "3 of 539" from "3 of 3" without paging. An unmarked truncation is
worse than a large payload: it looks like a complete answer and is not.
`nextCursor` is absent (not `null`-but-present) on the final page, so "more
exist" is a single unambiguous check.

### D3 — Cursor keyed on a stable sort, not an offset

Sort **descending by the repo's existing recency convention** —
`endedAt ?? lastActivityAt ?? startedAt` (matching `endedSortKey` server-side and
`session-card-time.ts` client-side) — with `id` as the tiebreak, and encode the
cursor as that key pair. Diverging from that convention would make the tool's
ordering disagree with the UI for the same store.

An integer offset over a mutating `Map` skips or repeats rows when a session is
created mid-walk — precisely the "concurrent mutation" scenario the spec requires
to hold. A keyset cursor is immune to insertions outside the walked range.

Load-bearing details, each empirically grounded:

- **The `id` tiebreak is required, not decorative.** The live store has **3
  sort-key collisions** among 538 visible rows (sessions sharing a timestamp).
  Without the tiebreak those rows can repeat or vanish across a page boundary.
- **Non-finite keys are rejected at the boundary.** Discovery-restored rows
  synthesize timestamps from an unvalidated header
  (`session-discovery.ts`), so a corrupt value can yield `NaN`, which breaks
  total ordering (every comparison is false → skip/repeat). Rows whose sort key
  is not finite sort last under a deterministic fallback rather than corrupting
  the walk. Live count today: **0**, so this is a guard, not a hot path.
- **Removal is tolerated, not just insertion.** A cursor names a *position in the
  ordering*, not a row, so a row removed by the archive sweeper between pages
  simply does not appear; the walk resumes at the next key strictly past the
  cursor. A removed row is the one legitimate exception to "appears exactly
  once" — it is not an *unrelated* row being skipped.
- **The cursor binds its query.** The encoded payload includes a digest of the
  filter arguments and limit. Presenting a cursor with different filters is
  rejected with `-32602` rather than silently walking a different result set.
- **Opacity is a contract, not a security boundary.** base64 is trivially
  decoded; it exists so the encoding stays private and changeable, and a
  malformed or unparseable cursor is rejected with `-32602`.

### D4 — Strict optional-argument validation lands in `dispatch.ts`, once

Rather than hand-validating inside the `list_sessions` handler, extend the
existing required-args loop into a small typed check driven by `inputSchema`
(type + enum + range + array items + unknown-key rejection), returning `-32602`.
This is the first tool with optional typed args; the next one will need it too,
and two hand-rolled validators would diverge. Kept deliberately small — no
JSON-Schema library, only the shapes the tool table actually uses.

Strictness is total, because every loose alternative produces a *silently wrong
answer* rather than an error:

- A numeric **string** (`limit: "25"`) is rejected, not coerced. Coercion makes
  the accepted grammar depend on the client's serializer.
- `limit: 0`, negatives and non-integers are rejected. `0` is especially
  dangerous: a naive `limit || DEFAULT` silently substitutes the default, which
  the contract forbids.
- A `limit` above the maximum is **rejected**, not clamped — same rule as every
  other out-of-range value, and a clamp is a silent substitution.
- An **unknown argument name** is rejected, finally enforcing the
  `additionalProperties: false` the tool table already declares. A misspelled
  `statuss` currently returns a full unfiltered page that the caller believes was
  filtered.

This requires widening `McpToolDef.inputSchema.properties` (see proposal Impact).
The widening must not change validation behaviour for the existing tools.

### D5 — Filters are three concrete predicates with pinned semantics

- **`status`** — an **array** of `SessionStatus` values
  (`"active" | "idle" | "streaming" | "ended"`), matching any listed value. The
  motivating query needs three of the four (live: 5 `active` + 5 `streaming`
  non-ended), so a single-value filter could not answer it in one call. An
  unknown status string is rejected by the enum check.
- **`cwd`** — compared using the repo's existing `pathKey(cwd, process.platform)`
  normalization rather than raw string equality, so trailing-slash and
  case-variant paths match as the rest of the system matches them.
- **`since`** — an epoch-milliseconds number, compared against the **same sort
  key** used for ordering (`endedAt ?? lastActivityAt ?? startedAt`). Defining it
  against the sort key keeps "page through everything since T" coherent with the
  cursor; defining it against `startedAt` while sorting by recency would not.

### D6 — `hidden` sessions are excluded by default

`listAll()` includes `hidden: true` worker sessions (live: 1); the UI excludes
them. The tool matches the UI, since an LLM caller asking "what sessions exist"
means the same thing a human reading the sidebar means. No opt-in argument is
added until something needs one.

## Risks / Trade-offs

- **Breaking the default response shape** → no in-repo production consumer
  exists; existing plugin tests pin the old shape and move with the change. The
  external blast radius is any operator-configured MCP client. Called out as
  BREAKING in the proposal and in the tool description.
- **The hard maximum still permits a large response** → 200 rows measures 244 KB.
  That is a deliberate ceiling for a caller that explicitly asks for it, not the
  default path; row reshaping (the real fix for per-row weight) stays a non-goal.
  Revisit by trimming `notifyLog`/`sessionFile` if 200-row pages are observed in
  practice.
- **Every page re-scans, re-filters and re-sorts the whole map** → O(N log N) per
  page at N≈539 is negligible, but it is per-page, not once per walk. If the
  store grows an order of magnitude, revisit with a maintained index. Do not
  build the index now.
- **Strict validation will reject clients that stringify numbers** → accepted
  deliberately (D4); the failure is a loud `-32602` at the first call, not a
  wrong answer later. Revisit only if a real client is found doing it.
- **Binding filters into the cursor** means a caller cannot change page size
  mid-walk; they must restart the walk. Acceptable — the alternative silently
  returns an incoherent result set.

## Migration Plan

Additive arguments plus a changed default. No data migration. Rollback = revert;
the tool returns to its unbounded behaviour.

## Open Questions

(none — the `status` cardinality question is resolved in D5: it takes an array.)
