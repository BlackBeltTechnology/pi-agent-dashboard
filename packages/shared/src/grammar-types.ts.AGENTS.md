# grammar-types.ts — index

Wire contract for composer grammar/spell check (client↔server). Types `GrammarBackendKind` (1-member `"llm"` — LanguageTool removed), `GrammarCorrectionView` (`redline`|`list`), `GrammarIssueKind`, `GrammarSuggestion`, `GrammarCheckResult`, `GrammarCheckRequest`, `GrammarHealth` (enabled/backend + non-secret tuning incl. `correctionView`; NO `languagetool` block), `GrammarErrorCode`. See changes: add-composer-grammar-check, add-grammar-compact-view, grammar-llm-only-with-explore.
