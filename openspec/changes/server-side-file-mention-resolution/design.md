# Design — server-side file-mention resolution

## Problem framing

Today: `tokenize()` (client) is BOTH detector and resolver. It decides a span is
a file AND commits its resolved path, with zero filesystem knowledge. Every
mismatch between "looks like a path" and "is a real file" ships as a dead or
wrong link.

Inversion: **detection stays on the client (cheap, synchronous), resolution +
validation move to the server (has the filesystem).** A span is styled as an
openable link only after the server confirms it names a real, in-scope file.

## Evidence (12 recent chatlogs, 4,521 mentions, 41,842 repo files)

| Outcome | Count | % | Handling |
|---|---|---|---|
| abs/tilde/rel-to-cwd exists | 1,625 | 35.9% | Phase 1 — deterministic |
| unique basename/suffix search | 326 | 7.2% | Phase 2 — fuzzy, safe |
| ambiguous basename collision | 368 | 8.1% | **refuse** (never auto-pick) |
| not found | 2,202 | 48.7% | render as plain text |

Upside of loosening: 182 currently-missed mentions resolve to exactly one file.
Collision hotspots (why auto-pick is forbidden): `spec.md` 1781 paths,
`tasks.md` 725, `AGENTS.md` 127, `index.ts` 50, `package.json` 46.

## Decisions

### D1 — Resolution is lazy + batched, not an eager index

Server does NOT pre-index 41k files. On demand it evaluates ONE mention:
expand `~` → try absolute → try `path.resolve(cwd, mention)` → (Phase 2)
`git ls-files` basename scan. The client sends the mentions visible in a message
as one batch (`POST /api/file/resolve-mentions`), so the round trip is per
message, not per link. Results cache on `(cwd, mention)`.

### D2 — Containment BEFORE stat (security)

Every resolved path passes the existing `isAllowed` gate (cwd + git-root
widening) BEFORE any `fs.stat`. `~/../../etc/passwd` expands then fails
containment → `resolved: null`. Phase-2 search is scoped to `git ls-files`
output, which is inherently inside the repo — no arbitrary walk.

### D3 — Never auto-pick on ambiguity

A fuzzy match resolves ONLY when exactly one tracked file matches the basename
(or the mention's path-suffix uniquely selects one). >1 match → `resolved:
null`. Opening the wrong `tasks.md` is worse than no link. This is the load-
bearing guardrail; the collision data proves it fires on the most-mentioned
names.

### D4 — Client renders plain text until confirmed

Loosened detection marks ~2× more candidates, but ~49% resolve to nothing.
Unconfirmed candidates MUST render as plain text, never dead links. The link
styling is applied post-confirmation. This is the one real interaction change vs
today's synchronous all-client model — links become async.

### D5 — `resolveLinkOrigin` / worktree interaction

Worktree re-rooting (existing) currently runs client-side on absolute tokens.
With server resolution, re-rooting folds into the server resolver (it knows the
session cwd + git root). A `~/…` home path is home-rooted, never a parent-
checkout path, so it bypasses re-rooting.

## Open questions

1. Batch validation vs lazy-on-click: batch avoids dead-looking links but costs
   a round trip per message; lazy-on-click is cheaper but shows unvalidated blue
   text. Proposal picks batch — confirm before build.
2. Phase-2 path-suffix matching precision: is `lib/foo.ts` matched against
   `.../packages/server/src/lib/foo.ts` by suffix, and is that unique often
   enough to be worth the complexity? Measured suffix-unique was only 0.2%
   (9 mentions) — Phase 2 may reduce to basename-unique only.
3. Non-repo cwds (Documents, arbitrary pinned dirs) have no `git ls-files`;
   Phase 2 fuzzy degrades to disabled there. Acceptable.

## Non-goals

- ESM `.js` → `.ts` source remapping (separate known gap).
- Eager filesystem indexing / a persistent file-name database.
- Multi-file disambiguation UI (a picker for ambiguous hits) — future, not now.
