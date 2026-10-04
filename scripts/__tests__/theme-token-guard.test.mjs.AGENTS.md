# __tests__/theme-token-guard.test.mjs — index

Tests for `theme-token-guard.mjs`: scan + ratchet per arm on `fixture()` temp trees, real-tree pass on all three arms. `accentText`: text-paint forms (G1), `.css` (G2), negatives incl. `-text`/bg/border/fill/stroke (G3), allowlist this-arm-only (G5, G11), new/grown/reintroduced sites (G6–G8), baseline integrity + DiffView stays baselined (G10, G12); `--bootstrap-arm` refusals via in-process `main()` (X1–X7). See change: remediate-accent-text-contrast.
