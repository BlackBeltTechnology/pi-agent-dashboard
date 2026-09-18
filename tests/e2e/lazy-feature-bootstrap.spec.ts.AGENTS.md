# lazy-feature-bootstrap.spec.ts — index

L3 cold-landing gate for `add-lazy-terminal-diff-bootstrap` (F1, P1). F1: a fresh session's default chat view fetches no `/assets/(xterm|diff)-*` chunk (JS or CSS). P1: landing root JS transfer (entry + `modulepreload`, excluding the out-of-scope `markdown-*`/`mdi-*` vendors) is ≥30 % below the committed baseline (1,262,352 B).
