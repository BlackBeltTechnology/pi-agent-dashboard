# DOX — packages/client/src/lib/security

Trusted Types policy set. One row per source file.

| File | Purpose |
|------|---------|
| `trusted-types.ts` | Named policies `pi-sanitized-html` (`(html, profile)` → DOMPurify with `shared/sanitize-profiles`; `eml` also resolves own blob: cid refs + constant wrapper), `pi-worker-url` (same-origin `/sw.js` / `/assets/<f>.m?js`; DEV adds Vite worker paths) + one mode-aware `default` (mode from `<meta name="pi-trusted-types">`, missing → report: pass-through + count; enforce: tag-free passes, `<svg` → mermaid profile, else HTML+SVG+MathML, `createScript` → null, script URLs → allowlist). Exports `installTrustedTypes`, `readTrustedTypesMode`, `trustedSanitizedHtml`, `trustedEmlSrcDoc`, `trustedWorkerUrl`; violation reporter `recordViolation`, `flushViolations` (≤ 50 keys + `overflow`, no samples, never throws), `startViolationReporter` (30 s + pagehide). Sanitizes with or without browser TT support. Allowlisted raw-sink module. See change: harden-client-sinks. |
