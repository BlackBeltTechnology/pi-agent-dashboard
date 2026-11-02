# safe-local-path.ts — index

`isSafeLocalPath(raw)`: the ONE same-origin request-path predicate (single leading `/`, no `//`/`\`, no control chars, stays on origin). Used by `sanitizeReturnUrl` and `pi-dashboard api`. Dependency-free. See change: close-container-loopback-impersonation (D4).
