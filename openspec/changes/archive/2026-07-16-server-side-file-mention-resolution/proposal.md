# server-side-file-mention-resolution

## Why

File links in tool output are resolved **entirely on the client** by a strict
regex tokenizer with zero filesystem knowledge. Measured against 12 recent
chatlogs (1,713 links, 41,842 repo files):

1. **Broken links ship to the UI.** 774/1,713 links resolve to no file. `~/…`
   home paths split the tilde and root at `/` (19/19 mislinked; several point at
   real home files). The client cannot validate — it has no filesystem.
2. **The strict grammar misses real files** — bare basenames the LLM drops
   without a path prefix. Up to 182 in the sample map to exactly one tracked
   file (an upper bound; untracked just-written files are invisible to search).

The filesystem lives on the **server**, which already owns the resolution
primitives (`isAllowed` containment, git-root widening, `realpath`). Invert
responsibility: **client detects, server resolves against the real filesystem
lazily on open.**

## What Changes

### Phase 1 — lazy server resolution + tilde (fixes the broken/tilde links)

- Add `POST /api/file/resolve-mention` (`{ cwd, mention }` → `{ resolved:
  string | null, kind }`). Resolution: expand a leading `~/` to `os.homedir()`,
  then try absolute / relative-to-cwd, each through the existing containment gate
  BEFORE `fs.stat`.
- **Security precondition (load-bearing):** `cwd` is untrusted request input.
  The endpoint runs behind `networkGuard` and rejects any `cwd` not in the
  known-session set BEFORE resolving — the same cwd-validation every other file
  route enforces (session cwd + git-root anchors, NOT the wider exists-only
  pinned set). Containment anchored on an attacker-chosen `cwd` is otherwise a
  tautology.
- Client detection is **unchanged** (strict, synchronous, offline-safe). On
  **click**, `FileLink` calls the endpoint and opens the server-resolved path
  (matches the original "check on open" concept). The server owns worktree
  re-rooting; the client stops double-resolving server-resolved paths. A fetch
  failure (not a null result) falls back to today's client-side open — no
  render-time server dependency, no async render flash.

### Phase 2 (opt-in) — loose detection + unique-only fuzzy, cost owned

- Loosen client detection to mark bare `basename.ext` candidates; these render as
  plain text until a batched pre-confirm returns a real file (server-confirmation
  gates prose false positives like `Node.js` / `math.PI`).
- On a Phase-1 miss the server MAY search the session tree's tracked files
  (`git ls-files`, scoped to the session's own worktree, bounded) and resolve a
  link ONLY when exactly one tracked file matches AND it `fs.stat`-confirms on
  disk. Basename collisions (`spec.md`, `tasks.md`, `AGENTS.md`) return null —
  never auto-picked. Suffix matching is dropped (0.2% yield).

## Impact

- Supersedes the retired `fix-tilde-home-linkify` (tilde folds into Phase 1).
- Affected spec: `tool-output-linkification` — Phase-1 requirements (server
  resolution with the untrusted-`cwd` gate; lazy-open behavior) are ADDED now;
  the Phase-2 fuzzy + loosened-detection requirement (which also MODIFIES the
  existing "bare `README.md` MUST NOT link" rule) lands when Phase 2 is
  scheduled. Spec rows are phase-labeled so `openspec-apply` does not treat
  fuzzy as Phase-1 scope.
- Affected code: `packages/server/src/routes/file-routes.ts` (endpoint +
  `resolveFileMention()` lib reusing the `/api/file/exists` cwd gate),
  `packages/client/src/components/tool-renderers/FileLink.tsx` +
  `useFileOpenRouting.ts` (resolve-on-click, drop double re-root),
  `linkify-tool-output.ts` (Phase 2 only).
- Affected tests: `resolveFileMention()` unit tests (unique→resolve,
  collision→refuse, tilde→home, `../` traversal→reject, untrusted-cwd→403,
  index-only-not-on-disk→null); FileLink click-resolves + offline-fallback test.
- Performance: Phase 1 is one stat-scoped resolve per click. Phase 2 owns the
  batch/`git ls-files` cost (debounce, request cap, TTL cache, non-repo skip).

## Discipline Skills

- `security-hardening` — the untrusted-`cwd` gate, containment-before-stat, and
  fuzzy search scoped inside the session tree are all security boundaries.
- `performance-optimization` — Phase-2 batched pre-confirm + bounded
  `git ls-files`; measure per-click and per-batch cost before shipping Phase 2.
