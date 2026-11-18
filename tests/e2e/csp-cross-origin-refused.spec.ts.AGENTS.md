# csp-cross-origin-refused.spec.ts — index

F5 default lane: page on `localhost:<port>`, `fetch` + `<img>` to `127.0.0.1:<port>` refused (`TypeError`; `connect-src` + `img-src` violations). Skips without an enforcing header. See change: enforce-strict-csp-default.
