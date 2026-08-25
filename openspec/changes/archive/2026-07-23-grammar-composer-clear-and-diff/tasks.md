## 1. Clear the panel on an empty composer

- [x] 1.1 Add an effect in `useGrammarCheck` that calls `reset()` (aborts in-flight) when `draft.trim() === ""` and `status !== "idle"`; guard prevents a render loop
- [x] 1.2 Test: panel clears + suggestions empty after the draft is emptied (Send)

## 2. Word-level inline diff

- [x] 2.1 Add `diff@^8.0.3` to `packages/grammar-plugin` dependencies
- [x] 2.2 `grammar-diff.ts`: `diffTokens(original, replacement)` → `DiffSegment[]` via jsdiff `diffWordsWithSpace` (compared against a hand-rolled token-LCS; jsdiff chosen for tighter fused-punctuation diffs — see design.md D2)
- [x] 2.3 `GrammarPanel` renders each suggestion via `SuggestionDiff` (equal neutral / delete struck-red / insert green), replacing the whole-original/whole-replacement spans
- [x] 2.4 Tests: `diffTokens` round-trip + delta-tightness + fused-punctuation split; `GrammarPanel` highlights only changed words in a long sentence

## 3. Docs

- [x] 3.1 Update `packages/grammar-plugin/AGENTS.md` rows (new `grammar-diff.ts` + test, changed `GrammarPanel`/`useGrammarCheck`/`package.json`)

## 4. Verify

- [x] 4.1 Rebuild client + restart (`npm run build && curl -X POST .../api/restart`); confirm in the browser: sending a prompt clears the panel, and a one-word fix inside a long sentence highlights only the changed word
- [x] 4.2 Full `npm test` green across the repo (grammar-plugin 97/97; the only red is a pre-existing environmental LAN-bind flake in `pi-gateway-bind-host`, unrelated to this change)
