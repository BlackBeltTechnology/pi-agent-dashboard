# 39-cli-open.sh — index

L2 (test-plan #X15). `pi-dashboard open --print` against a live server prints `/auth/local-proof?code=<43 base64url>` and exits 0; against a dead port exits 1 with "server not running". See change: harden-trust-and-credential-boundaries.
