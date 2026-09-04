## Context

See `proposal.md` — Why. The constraints that actually shape the approach:

- **The keyspace is open.** `customType` is authored by third-party pi extensions at runtime. No compile-time enum, so
  the `toolCalls` pattern (fixed keys, fixed UI rows) cannot be copied wholesale.
- **The gate is client-side today.** `ChatView.tsx` decides visibility at two sites (`isRowVisible`, render branch)
  from `DisplayPrefs`. Any per-row classification must reach those sites.
- **`DisplayPrefs` already has shallow-merge machinery.** `toolCalls` is merged field-by-field by `mergeDisplayPrefs`
  and deep-merged by `PATCH /api/preferences/display`. A `Record<string, boolean>` rides that plumbing unchanged, and
  inherits the per-session override + "overridden" indicator for free.
- **There is a precedent for exactly this kind of config file.** `packages/shared/src/tool-registry/overrides.ts`
  persists `~/.pi/dashboard/tool-overrides.json`: versioned envelope, lazy disk load, in-memory cache, atomic
  tmp+rename persist, malformed file → empty rather than throw. The groups file should look like its sibling, not
  invent a new convention.
- **Observed scale is tiny.** 12 distinct `customType` values across every session on disk. Any per-type cost is
  effectively free; any per-row cost is not (3901 rows, re-evaluated on every re-render).

## Goals / Non-Goals

**Goals:**
- Per-group visibility reaching both existing preference surfaces with no new UI concept.
- A user-editable file that is also the *discovery source*, so the global settings panel can enumerate groups with no
  session open.
- Untrusted, user-authored regexes that cannot hang the UI thread or the server event loop.
- An upgrade that does not resurrect custom rows a user had already hidden.

**Non-Goals:**
- Hot-reload of the groups file. Restart-to-apply, matching `config.json`.
- Any UI for editing groups. Hand-edited, like `tool-overrides.json`.
- Detecting semantic overlap between two user regexes. Undecidable in general; ordering handles it instead.
- Per-`customType` toggles or a server-side "types ever seen" registry (both rejected during exploration).

## Decisions

### D1: Resolution runs server-side; rows arrive at the client pre-tagged with `groupId`

The server resolves `customType → groupId` and attaches `groupId` to the `custom_entry` event and to custom
`message_end` events (live and replay). The client gate collapses to a plain lookup:

```
  BEFORE                                   AFTER
  if (!prefs.customEntryFallback)          const gid = row.groupId ?? "other";
      return null;                         if (prefs.customEventGroups[gid] === false)
                                               return null;
```

*Why not resolve on the client?* Two reasons, and the second is decisive:

1. Shipping patterns to every browser puts an untrusted regex in N render threads instead of one server process.
2. **JavaScript cannot time-bound a synchronous regex.** There is no timeout argument, no interrupt, no abort — a
   catastrophically-backtracking pattern runs to completion or takes the thread with it. On the main browser thread
   there is no recovery at all. Server-side, the match can be moved off-thread and killed (D3).

*Trade-off:* the protocol and the reducer gain a field, and a row already in a client's store keeps the `groupId` it
was tagged with. Because reload is restart-only (D5), a config change implies a fresh process and a fresh replay, so
stale tags are not reachable in practice.

*Client fallback:* a row arriving with no `groupId` (older server, or an emitter path not yet annotated) is treated as
`other`. Fail-visible, consistent with the fail-open rule in the spec.

### D2: `id` is identity; `pattern` is definition

The pref key and the merge-tracking key are the group's `id`. `pattern` and `label` are freely editable without losing
state.

*Alternative considered — pattern-as-identity:* rejected. Editing a pattern is the single most likely user action on
this file (e.g. narrowing `^om\.` to split `om.observations.dropped` from `.recorded`). Keying off the pattern string
would silently drop the user's toggle state on exactly that edit, and would make the upgrade-merge see the group as
deleted and re-add it. Label-as-identity fails the same way. This mirrors `toolCalls`, which keys off
`read|bash|edit|agent|generic` rather than off anything user-visible.

### D3: Pattern matching runs in a `worker_threads` worker with a kill timeout

On a cache miss, the main thread asks a long-lived worker to test the patterns in order, **one pattern per message**,
carrying the pattern index. The main thread arms a timer per message:

```
   main                              worker
    |  {idx, pattern, customType}      |
    |--------------------------------->|  regex.test(...)
    |  timer armed (TIMEOUT_MS)        |
    |<---------------------------------|  {idx, matched}
    |  clear timer, continue
    |
    |  ---- timeout fires ----
    |  worker.terminate()              X   (thread dies mid-backtrack)
    |  quarantine group at idx, log
    |  respawn worker, resume at idx+1
```

Sending one pattern at a time is what makes the offending group *identifiable* — a batched call would only tell us that
"something" hung. The extra round trips are irrelevant: this path runs once per distinct `customType` per process, and
the observed keyspace is 12.

Quarantine is in-memory for the process lifetime. The user's file is never rewritten as a result — a pathological
pattern is a user error to fix in the file, not something the server silently edits.

*Alternatives considered:*
- **RE2 (`node-re2`)** — linear-time by construction, no timeout needed. Rejected: a native dependency needs
  per-platform binary proving across every OS the dashboard ships to (including the Electron and Docker targets), which
  is a disproportionate cost for a filter feature.
- **Static safety guard** (cap pattern length, reject nested quantifiers) — cheap but not airtight; catches the textbook
  footguns and misses the rest.
- **Glob-only pattern language** — would make ReDoS structurally impossible and covers all five shipped patterns, which
  are pure prefixes. Rejected in favour of keeping full regex expressiveness.

### D4: First-match-wins ordering, with merged groups appended last

Resolution walks `groups` in order and takes the first match; unmatched falls to the reserved `other` group. The `other`
group is synthesized if the file omits it, so a hand-edited file cannot produce an unroutable type.

Upgrade-merge appends newly shipped groups **after** user-authored entries. This is what makes overlap harmless without
trying to detect it: if a user already wrote a broader rule covering what a new shipped group targets, their rule keeps
winning and the merged group is simply inert — a cosmetic empty toggle rather than a behavior change.

### D5: `seenShippedIds` gates the upgrade-merge

A shipped group is added to an existing file only when its `id` is absent from `seenShippedIds`; the id is recorded
whether or not the user keeps the group.

*Why:* naive merge-on-upgrade resurrects anything the user deliberately deleted, on every single release, forever. This
is the difference between "coverage stays current" and "the file fights you". The cost is one string array.

### D6: Restart-to-apply, no file watcher

`config.json` already establishes restart-to-apply for dashboard config. Reusing it removes cache invalidation, the
"rows tagged under an old config" problem from D1, and a watcher.

### D7: `customEntryFallback` is removed, not deprecated in place

A one-shot migration maps `customEntryFallback` onto `customEventGroups.other` in the global prefs and in every
per-session override, then drops the field. Placed alongside the existing legacy migrations
(`migrate-persistence.ts` / `backfillDisplayPrefs`), which already establish the once-and-idempotent pattern for this
store — including the precedent migration from the `show-debug-tools` localStorage flag.

*Why not keep both fields:* two switches gating the same rows is a bug generator, and the semantics of their
conjunction would have to be specified and tested for no user benefit.

## Risks / Trade-offs

- **A pathological pattern still costs one timeout per affected `customType`.** → Bounded: quarantine is per-group and
  sticky for the process, so a bad group costs at most one timeout, not one per type or per row.
- **Worker respawn on terminate adds a failure mode of its own** (respawn storm if every pattern hangs). → Quarantine is
  applied before resuming, so the worker can be killed at most once per configured group per process.
- **Protocol gains a `groupId` field** — a mixed-version bridge/server sends rows without it. → Client treats a missing
  `groupId` as `other`, so an un-annotated row is visible under default prefs rather than vanishing.
- **`om.*` shipping as default-hidden changes what an existing user sees on upgrade** (2901 rows disappear). This is the
  intended outcome, but it is a visible behavior change nobody asked for individually. → Called out in CHANGELOG; the
  group is one toggle away in both surfaces, and the migration never overwrites an explicit user choice.
- **Restart-to-apply will surprise someone editing the file** with the dashboard running. → Document in the config
  reference next to `config.json`, which has the same property.
- **The `other` group is a semantic grab-bag** — a new third-party emitter lands there and inherits whatever the user
  set for unrelated types. → Accepted; it is strictly better than today, where it inherits a switch shared with
  `web-search-results`.

## Migration Plan

1. Ship the loader with defaults; file is created on first boot after upgrade.
2. `backfillDisplayPrefs` seeds `customEventGroups` from the configured group defaults for legacy prefs files.
3. The one-shot `customEntryFallback → customEventGroups.other` migration runs over global prefs and every session
   override, then the field is dropped.
4. Presets (`simple` / `standard` / `everything`) and `FirstLaunchDisplayModal` carry the new field.

**Rollback:** revert restores `customEntryFallback` reading from prefs files that no longer contain it. The backfill
already defaults it to `true`, so a rolled-back build shows custom rows rather than hiding them — noisy, not
destructive. The groups file is inert to the old build and can be left on disk.

## Open Questions

- Whether `om.observations.dropped` warrants its own group separate from `.recorded` (660 vs 1417 rows; "dropped" is
  arguably pure debug). Deferrable: adding a group later is a defaults change plus a `seenShippedIds` entry, with no
  schema, spec, or task impact.
- The exact worker timeout value. Deferrable: any value in the tens-of-milliseconds range satisfies the requirement;
  tuning needs measurement that only exists once the code runs.
