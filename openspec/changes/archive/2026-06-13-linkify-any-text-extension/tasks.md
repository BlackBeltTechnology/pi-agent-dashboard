# Tasks: linkify-any-text-extension

## 1. Tests first (define behavior)

- [x] 1.1 Add failing cases to `packages/client/src/lib/__tests__/linkify-tool-output.test.ts`:
  - `.pi/settings.json` → one `file` token, `path=".pi/settings.json"`, no stray `on`
  - `src/data.json` → `path="src/data.json"` (not `src/data.js`)
  - `.github/workflows/ci.yml` → `path=".github/workflows/ci.yml"`, `absolute` falsy
  - `a/.config/b.ts` → `path="a/.config/b.ts"`, `absolute` falsy, single token
  - `../../packages/server/src/cli.ts` → full path, `absolute` falsy
  - `config/app.toml:12` → `path="config/app.toml"`, `line=12`
  - `scripts/setup.lua`, `config/db.sql` → generic exts linked
  - Negative: `Node.js`, `README.md` (bare), `v1.2.3`, `and/or` → no file token
- [x] 1.2 Run `npm test 2>&1 | tee /tmp/pi-test.log`; confirm the new cases FAIL (verify: `grep -nE 'FAIL|✗' /tmp/pi-test.log`).

## 2. Implement generic extension + bug fixes

- [x] 2.1 In `packages/client/src/lib/linkify-tool-output.ts`, remove `EXTS`/`EXT_GROUP`; introduce `EXT = "[A-Za-z][A-Za-z0-9]{0,15}"` (alpha-first, length-capped) used in all file branches.
- [x] 2.2 Bug B — revise relative segment grammar to admit leading-dot directories (leading dot-dir when followed by separator; interior dot-dir segments) while keeping the word-start guard on a bare first segment (`1.2.3` stays non-pathy).
- [x] 2.3 Bug C — change the relative prefix to `(?:\.{1,2}\/)+` (one-or-more `../`); ensure the relative branch claims interior-slash tails before `file_posix`. If branch ordering alone is insufficient, move the relative branches ahead of `file_posix` (URL stays first); confirm absolute scenarios still pass.
- [x] 2.4 Keep `Token` shape, `tokenize` signature, `MAX_LINKS`, `splitLineCol`, URL punctuation strip, `file://` decode, and absolute-marking unchanged.

## 3. Verify green + invariants

- [x] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log`; all linkify tests green (verify: `grep -nE 'FAIL|✗' /tmp/pi-test.log` returns nothing).
- [x] 3.2 Confirm fuzz coverage invariant holds: `tokens.map(t=>t.text).join("") === input` (`linkify-tool-output.fuzz.test.ts`).
- [x] 3.3 Confirm perf test still passes (`linkify-tool-output.perf.test.ts`) — no quadratic blowup from the widened grammar.
- [x] 3.4 `openspec validate linkify-any-text-extension --strict`.

## 4. Manual + build

- [x] 4.1 `npm run build && curl -X POST http://localhost:8000/api/restart`; in the live UI, confirm an assistant message containing `` `.pi/settings.json` ``, `../../foo.ts`, and `config/app.toml` renders correct clickable links.
- [x] 4.2 Update the per-file row for `linkify-tool-output.ts` in `docs/file-index-client.md` (delegate to a docs subagent, caveman style) noting generic-extension detection + the three bug fixes.
