# copy-insecure-context.spec.ts — index

L3 test-plan #X3 (change: fix-long-session-ux-degradation, D2). Deletes `navigator.clipboard` pre-load (plain-http zrok/ngrok shape) → real faux `copy-surfaces` → asserts CopyButton ✓ appears via the hidden-textarea + execCommand fallback, no residual textarea.
