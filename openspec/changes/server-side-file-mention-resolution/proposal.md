# server-side-file-mention-resolution

## Why

File links in tool output are resolved **entirely on the client** by a strict
regex tokenizer. Two structural problems follow, both measured against 12 recent
chatlogs (4,521 file-mentions, 41,842 repo files):

1. **Broken links ship to the UI.** The client marks a token as a link with no
   filesystem check. `~/…` home paths split the tilde and root at `/` (19/19
   mislinked; several point at real home files). Doc-example and ESM-`.js`
   paths render as clickable dead links. The client cannot validate — it has no
   filesystem.
2. **The strict grammar misses real files.** Bare basenames the LLM drops
   without a path prefix (`monaco-setup.ts`, `BinaryWarn.tsx`) are never linked
   — 182 such mentions in the sample resolve to exactly one real file, but the
   client can't know that.

The filesystem lives on the **server**, which already owns the resolution
primitives (`isAllowed` containment, git-root widening, `realpath`). The fix is
to invert responsibility: **client detects loosely, server resolves and
validates against the real filesystem, only confirmed mentions render as
openable links.**

Measured resolver outcomes on the 4,521 candidates justify a two-phase scope:

```
resolved deterministically (abs/tilde/rel-to-cwd exists)  35.9%   Phase 1
resolved by unique basename/suffix search                  7.2%   Phase 2
ambiguous basename collision (MUST NOT auto-pick)          8.1%   guardrail
not found (render as plain text, never a dead link)       48.7%   Phase 1
```

## What Changes

### Phase 1 — existence-gated server resolution (owns the broken-link + tilde fix)

- Add a server endpoint `POST /api/file/resolve-mentions` that takes `{ cwd,
  mentions: string[] }` and returns, per mention, `{ resolved: string | null,
  kind: "abs" | "tilde" | "relative" }`. Resolution: expand a leading `~/` to
  `os.homedir()`, then try absolute / relative-to-cwd, each passed through the
  existing anti-traversal containment gate BEFORE any filesystem stat.
- Client tokenizer LOOSENS detection to mark more candidates, but a candidate
  renders as an **openable link only after the server confirms `resolved !==
  null`**; unconfirmed candidates render as plain text (no dead links).
- The client batch-validates the mentions visible in a message in one round
  trip; resolution result is cached per `(cwd, mention)`.

### Phase 2 — unique-only fuzzy fallback

- When Phase-1 resolution misses, the server MAY search for the mention's
  basename (and path-suffix) among tracked files (`git ls-files`, bounded).
- A fuzzy hit resolves the link **only when exactly one file matches**. On a
  basename collision (`spec.md`, `tasks.md`, `AGENTS.md`, `index.ts`, …) the
  server returns `resolved: null` — it MUST NEVER auto-pick one of many.

## Impact

- Supersedes the retired `fix-tilde-home-linkify` (its tilde behavior is folded
  into Phase 1).
- Affected spec: `tool-output-linkification` — new server-resolution
  requirements + a loosened client-detection requirement + the
  never-auto-pick-on-collision guardrail.
- Affected code: `packages/server/src/routes/file-routes.ts` (new resolve
  endpoint + `resolveFileMention()` lib), `packages/client/src/lib/
  linkify-tool-output.ts` (loosen grammar), `FileLink` / a new validation hook
  (async confirm before styling as link), `resolveLinkOrigin` interaction.
- Affected tests: `resolveFileMention()` unit tests (unique→resolve,
  collision→refuse, tilde→home, `../` traversal→reject); client tests for
  render-as-plain-text-until-confirmed.
- Performance: resolution is lazy/batched, not an eager 41k-file index. Phase 2
  scopes search to `git ls-files` (tracked files) with a hard result cap.

## Discipline Skills

- `security-hardening` — server expands `~` and searches the filesystem on
  behalf of an authenticated browser; every path MUST pass the existing
  containment gate BEFORE stat, and fuzzy search MUST stay inside cwd/git-root.
- `performance-optimization` — batched/lazy resolution and a bounded
  `git ls-files` search; measure the round-trip cost per message before shipping.
