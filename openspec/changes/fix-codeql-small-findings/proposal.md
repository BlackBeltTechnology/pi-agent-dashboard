# Fix CodeQL Small Findings

## Why

GitHub CodeQL (default setup, `javascript-typescript` suite `code-scanning`)
reports ~105 open non-path-injection alerts on `develop`. A local re-run (CLI
2.27.2, same as GitHub) and triage split them into noise (tests, scripts,
mockups — excluded by `add-local-codeql-ratchet`), accepted-by-design (operator
APIs behind the universal network guard), and a small set that are **real or
cheap to make unambiguous**. This change fixes that small set *before* the
local CodeQL ratchet lands, so its seed baseline starts smaller and every
remaining entry is a deliberate acceptance. The three Mermaid SVG alerts
(`MermaidBlock.tsx`) are owned by `sanitize-untrusted-rendered-content`.

Measured, not assumed — the ReDoS alerts were timed with CodeQL's own witness
inputs (Node 24):

| Site | Witness | Measured | Verdict |
|---|---|---|---|
| `kb/src/dox-triage.ts` `ROW_RE` (`parseRows`, used per kb search by `verdict.ts:182`) | a DOX row head followed by 2 000 spaces | 1.4 s (cubic) | real |
| `kb/src/chunker.ts:127-128` wikilink / md-link regexes (kb indexing) | `[[` / `](` × 26 000 | 1.5 s / 0.7 s at 80 kB | real |
| `shared/src/git-worktree-helpers.ts` `slugifyBranch` (`-+$`, branch name from a route body) | `a` + 80 000 `-` + `a` | 2.2 s | real |
| `shared/src/source-matching.ts:91` `/\/+$/` | 80 000 `/` + `x` | 2.2 s | real |
| `shared/src/skill-block-parser.ts:63` | CodeQL witness | < 1 ms | false positive (trailing `[\s\S]+` always matches) |

## What Changes

**Linear-time parsing** (new capability `bounded-input-parsing`): replace the
super-linear regexes with linear scans that return identical results on every
input — including the two further copies of the DOX row regex
(`kb/src/dox.ts:320`, `kb/src/migrate-file-index.ts:13`) and its quadratic loose
variant in `kb/src/migrate-runner.ts:121` (parses subagent output).

**Markdown table escaping** (`doctor-diagnostic`): the doctor Markdown export
escapes `|` in the message cell but not `\`, so a message ending in `\` turns
the escaped pipe into a cell break. Escape backslash first, via one shared
`escapeMdTableCell` helper (shared formatter + web Diagnostics copy) and the
same three-step escape inline in the Electron `doctor.html` page. Intended side
effect: Markdown escapes inside messages (`x\*y\*`) now render literally.

**Grounding gate identifiers** (`kb-file-index-migration`): the grounding regex
escapes only `$` and wraps the id in `\b…\b`, so an identifier starting with `$`
is never found, and `Foo` counts as present inside `$Foo` or `Foo$bar`. Use a
full regex escape and identifier-alphabet boundaries.

**Clean-ups** (no spec delta; identical for every input current callers produce):
- `bus-client/src/codegen/generate-verbs.ts:92` — delete the no-op
  `.replace(/\n/g, "\n")` (generated `verbs.ts` unchanged).
- `client/.../OpenSpecBoardView.tsx:242-244`, `client/.../SessionList.tsx:121-125` —
  the non-`CSS.escape` fallback (jsdom only) escapes `"` only; both use a new
  shared `cssEscape` whose fallback hex-escapes every non-identifier character.
- `server/src/git-worktree/git-operations.ts:443,453` — parse the
  `%(refname:short)%(HEAD)` line as trimmed name plus optional trailing `*`
  instead of replacing the first `*` (git forbids `*` in ref names).
- `electron/src/main.ts:393` — embed the splash-status text with
  `JSON.stringify(text)` instead of escaping only `` ` `` and `$`.
- `client/.../YouTubePreview.tsx:26` — `extractYouTubeId` uses the exact
  `YOUTUBE_HOSTS` set from `preview-dispatch.ts:23` instead of
  `endsWith("youtube.com")`; non-canonical hosts now yield `null`, but none can
  reach it today because dispatch routes only that set to `YouTubePreview`.

**Not changed:** `skill-block-parser.ts` (measured false positive) — its alert is
accepted with that reason in the `add-local-codeql-ratchet` baseline.

## Capabilities

### New Capabilities
- `bounded-input-parsing`: text parsers fed by repository, agent or request
  content run in linear time.

### Modified Capabilities
- `doctor-diagnostic`: Markdown export escapes table cells correctly (ADDED requirement).
- `kb-file-index-migration`: grounding gate recognizes `$`-containing identifiers (ADDED requirement).

## Impact

- Code: `packages/kb/src/{dox-triage,migrate-file-index,chunker,migrate-runner}.ts`
  (+ refreshed `packages/kb/engine-fingerprint.json`),
  `packages/shared/src/{git-worktree-helpers,source-matching,doctor-core}.ts`,
  new `packages/shared/src/md-table-cell.ts`,
  `packages/client/src/components/settings/DiagnosticsSection.tsx`,
  `packages/electron/src/renderer/doctor.html`, `packages/electron/src/main.ts`,
  `packages/server/src/git-worktree/git-operations.ts`,
  `packages/bus-client/src/codegen/generate-verbs.ts`,
  `packages/client/src/components/{openspec/OpenSpecBoardView,session/SessionList,preview/YouTubePreview}.tsx`,
  `packages/client/src/lib/preview/preview-dispatch.ts` (export the host set),
  new `packages/kb/src/dox-row.ts`, `packages/kb/src/{dox,indexer}.ts`,
  new `packages/client/src/lib/css-escape.ts`.
- No API, config, data or dependency change. Rollback = revert.
- Expected CodeQL effect: the listed alerts close on the next analysis
  (to be confirmed by the local run in `add-local-codeql-ratchet`).

## Discipline Skills

- `performance-optimization` — the ReDoS fixes are measure-first: a timed L1
  budget on the CodeQL witness inputs plus output equivalence on normal input.
- `security-hardening` — untrusted text reaching parsers on the server event
  loop (kb search verdicts, kb indexing, worktree routes).
