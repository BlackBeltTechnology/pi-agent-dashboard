## Context

`linkify-tool-output.ts` exposes `tokenize(text): Token[]`, a single-pass regex
tokenizer. Five file branches plus a URL branch make up the `COMBINED` regex.
Today every file branch ends in `\.${EXT_GROUP}` where `EXT_GROUP` is a fixed
19-entry alternation. The goal: accept any text extension while keeping prose
safe and fixing three detection defects.

## Key insight: path structure is the prose guard, not the extension

A bare `name.ext` token is **never** linked today — the relative branches require
a separator (`(?:SEG\/)+SEG\.EXT`) or a `./`/`../` prefix. Verified:

```
"package.json"  -> (none)        "tsconfig.json" -> (none)
```

So the extension allowlist's only unique contribution is rejecting odd absolute
tails like `/a/b/v1.2.3`. Replacing it with a generic extension is therefore safe
for the with-structure case and removes the maintenance treadmill.

## Decisions

### 1. Generic extension token

Replace `EXT_GROUP` with:

```
EXT = "[A-Za-z][A-Za-z0-9]{0,15}"   // 1–16 chars, alpha-first
```

- Alpha-first rejects all-numeric tails (`.2024`, `.0`, `.3`) so `v1.2.3` /
  `release.2024` don't masquerade as files even with a separator.
- Length cap (16) bounds backtracking and avoids swallowing a whole prose run.
- Removes Bug A entirely: no enumerated alternation ⇒ no `js`-before-`json`
  prefix collision. `.json`, `.jsonc`, `.tsx` all match in full.

> Tradeoff accepted (philosophy B): binary extensions (`.png`, `.zip`, `.pdf`)
> also linkify. Clicking routes to the preview overlay / editor as today; a
> binary just previews/fails — low harm, no list to maintain. A denylist can be
> layered later if desired (post-match filter in `tokenize`), out of scope here.

### 2. Relative segment class — admit dot-directories (Bug B)

Two segment classes today: `SEG` (relative, no leading dot) and `ASEG`
(absolute, dot-ok). Bug B is that relative paths use `SEG`, so `.pi`, `.github`,
`.config` segments break.

Decision: relative branches use a dot-tolerant segment for **non-leading**
segments, and a dot-tolerant *leading* segment, while preserving the `1.2.3`
prose guard. Concretely the relative path becomes:

```
RSEG  = "[\\w][\\w.-]*"            // first bare segment: word-start (prose guard)
RDIR  = "\\.?[\\w][\\w.-]*"        // subsequent / dot-dir segments: optional leading dot
```

- A dot-directory may appear after a separator (`a/.config/b.ts`) or as the
  leading segment when followed by a separator (`.pi/settings.json`,
  `.github/workflows/ci.yml`).
- A bare leading segment with no separator still uses the word-start guard so
  `Node.js`, `e.g.`, `3.14` remain non-pathy.

### 3. Multi-level parent traversal + precedence (Bug C)

- Relative prefix: `(?:\.{1,2}\/)+` (one-or-more) replaces the single optional
  `(?:\.{1,2}\/)?`, so `../../packages/server/src/cli.ts` matches whole.
- The relative branches (`file_line`, `file_ext`) must claim an interior-slash
  tail before `file_posix` can. Today `file_posix` is ordered earlier and starts
  at the interior `/`, stealing `../../foo.ts` → `/../foo.ts`. Because the regex
  walks left-to-right and the relative match now starts at the leading `..`
  (earlier index than the interior `/`), the leftmost-longest match at the
  earlier start position wins the linear scan — `file_posix` never gets the
  chance to start mid-token. Validate this with the `../../` and `a/.config`
  cases; if ordering alone is insufficient, move the relative branches ahead of
  `file_posix` in the alternation (URL must still stay first).

### 4. What stays unchanged

- `Token` shape, `tokenize` signature, `MAX_LINKS` overflow cap, `splitLineCol`
  line:col parsing, URL trailing-punctuation strip, `file://` percent-decode,
  absolute-marking semantics, and the coverage invariant
  `tokens.map(t=>t.text).join("") === input`.

## Risks

- **Regex breadth.** Generic ext + multi-`../` widens the match space. Mitigate
  with the alpha-first + length-cap and the existing fuzz test
  (`linkify-tool-output.fuzz.test.ts`) asserting coverage + no quadratic blowup
  (`.perf.test.ts`).
- **Branch reorder blast radius.** If decision 3 needs reordering, every existing
  scenario in `spec.md` must still pass. The full scenario set is the gate.

## Open questions

- Length cap value (16 chosen to cover `.gemspec`, `.cmake`; revisit if a longer
  real extension appears).
- Whether to also accept `_` in extensions (none common; excluded for now).
