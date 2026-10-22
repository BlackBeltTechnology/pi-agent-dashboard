# tls-status.ts — index

Browser-safe wire types of `/api/health.tls`: `TlsGate`, `TlsSourceStatus`, `TlsCertStatus` (held, notAfter ms, stage, lastError ≤500, nextAttemptAt), `TlsStatusBasic` (`enabled`,`bound` — everyone) / `TlsStatusDetail` (port, host, bindError, gates, sources, certs — authed or genuinely-local), `hasTlsDetail()`. Server builds them, Gateway "Built-in HTTPS" reads them. See change: add-tailscale-cert-tls.
