# ipc-trust.ts — index

Sender-frame trust for privileged `dashboard:*` IPC. `isTrustedSenderUrl(url, {loadingPagePath, localPort})` — true only for exact local `loading.html` file URL or loopback origin on the configured port; remote/tunnel denied, malformed fails closed. `trustedHandler` (rejects with `UntrustedSenderError`) / `trustedListener` (silent drop) wrappers. No electron import. See change: harden-electron-renderer-boundary (VD5).
