# lazy-mdi-icon-set.spec.ts — index

L3 for `harden-ios-safari-memory-and-ws-diagnostics` (P1, F2; issue #712). P1: cold landing fetches no `/assets/mdi-*.js` full-icon-set chunk; eager JS (entry + `modulepreload`, `decodedBodySize`) strictly below the 6,740,503 B pre-change baseline (notes.md). F2: `[[faux:footer-icon]]` → `e2e-custom` fixture tool `e2e_footer_segment` → footer-segment decorator `footer-segment:e2e:lazy-icon` renders the `mdiCheckDecagram` path; full set requested exactly once — proves P1's filename matcher names the real chunk (P1 non-vacuous). See change: harden-ios-safari-memory-and-ws-diagnostics.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 lazy MDI icon set (P1, F2).
