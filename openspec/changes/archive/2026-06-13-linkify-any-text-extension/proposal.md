## Why

The tool-output/markdown linkifier (`packages/client/src/lib/linkify-tool-output.ts`)
detects file references via a hardcoded extension allowlist (`EXTS` ~19 entries).
This is both too narrow and buggy:

- **Limited extensions.** Common text files (`toml`, `ini`, `env`, `lua`, `sql`,
  `kt`, `swift`, `rb`, `php`, `c`, `cpp`, `xml`, `csv`, …) are never linked.
  Growing the allowlist is an endless treadmill that always misses the next ext.
- **Bug A — `json` truncated to `js`.** `EXTS` is not globally longest-first;
  `js` precedes `json` and is a prefix of it. Ordered regex alternation matches
  `.js` first and stops, so `.pi/settings.json` renders as `.pi/settings.js` + a
  stray `on`. Empirically confirmed against the live regex.
- **Bug B — leading dot-directories dropped.** Relative segment class `SEG`
  forbids a leading `.`, and the relative prefix only matches literal `./` / `../`.
  So `.pi/settings.json` loses its dot (→ `pi/settings.js`) and `.github/...`,
  `a/.config/b.ts` break.
- **Bug C — multi-level `../../` mis-parsed as absolute.** The relative branch
  allows only one `../`. For `../../foo.ts` the relative branch fails on the 2nd
  `..`; the earlier-ordered `file_posix` branch then re-captures the interior
  tail as `/../foo.ts` and flags it `absolute: true`, corrupting the path and
  mis-routing the click.

The real prose guard is **path structure** (a `/` separator, `./`/`../`, a
leading `/`, a drive letter, or a `file://` scheme) — not the extension. A bare
filename is already never linked. Once path structure is present, the extension
allowlist is a redundant second guard. Dropping it to a generic extension pattern
extends coverage to every text extension AND eliminates Bug A by construction.

## What Changes

- Replace the enumerated `EXT_GROUP` (`(?:tsx|ts|…|txt)`) with a **generic
  extension token** `[A-Za-z0-9]{1,N}` (length-capped, e.g. ≤16) in all five
  file branches. Any extension now linkifies when path structure is present.
- **Preserve the "bare filename needs a separator or `./`/`../`" rule.** Bare
  tokens in prose (`Node.js`, `v1.2.3`, `e.g.`, `README.md` alone) MUST still
  NOT link. Generic extensions only apply where path structure exists.
- **Bug B fix.** Let relative path segments admit leading-dot directories
  (`.pi`, `.github`, `.config`) and let the relative prefix accept dot-dir
  segments, while keeping the `1.2.3` prose guard for the first bare segment.
- **Bug C fix.** Allow one-or-more leading `../` (`(?:\.{1,2}\/)+`) in the
  relative branch, and ensure the relative branch wins interior-slash tails so
  `file_posix` cannot re-capture a relative path as a bogus absolute.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-output-linkification`: file-reference detection no longer constrained to
  a fixed extension allowlist; generic extensions accepted when path structure
  present. Dot-directory and multi-level parent-traversal relative paths now
  detected correctly. The `js`/`json` truncation defect removed.

## Impact

- `packages/client/src/lib/linkify-tool-output.ts` — `EXTS`/`EXT_GROUP` removed
  or replaced by generic pattern; `SEG` and relative branch regex revised; no
  change to the `Token` shape, `tokenize` signature, overflow cap, line:col
  parsing, or coverage invariant.
- `packages/client/src/lib/__tests__/linkify-tool-output.test.ts` +
  `.fuzz.test.ts` — extended with json/dot-dir/`../../`/generic-ext cases; the
  coverage invariant (`tokens.join("") === input`) is the regression guard.
- No API / protocol / server changes. Client-only. Rebuild client + restart.
