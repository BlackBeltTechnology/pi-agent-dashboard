# SKILL.md — security-hardening index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/security-hardening/SKILL.md. Keys on triggers, threat-model process, three-tier boundary rules, OWASP patterns, audit triage, LLM rules, checklist gates.

## When to Use
- Triggers — "security audit", "harden this", "threat model", "is this safe". Touching untrusted input, auth, sessions, secrets, data storage, third-party integrations, uploads, webhooks, payment/PII.

## Process: Threat Model First
- Threat model before hardening — controls without it are guesses.
- 1 Map trust boundaries — HTTP, form fields, uploads, webhooks, third-party APIs, message queues, LLM output. Each = attack surface.
- 2 Name assets — credentials, PII, payment data, admin actions, money movement.
- 3 STRIDE per boundary — Spoofing→auth/signatures; Tampering→integrity/parameterized queries/HTTPS; Repudiation→audit logging; Info disclosure→encryption/allowlists/generic errors; DoS→rate limits/size caps/timeouts; Elevation→authz/least privilege.
- 4 Abuse cases next to use cases — "how would I misuse this?" → first test. Can't name boundaries → not ready. OWASP A04 Insecure Design.

## The Three-Tier Boundary System
- Always Do — validate input at boundary, parameterize queries, encode output, HTTPS, bcrypt/scrypt/argon2, security headers (CSP/HSTS/XFO/XCTO), httpOnly+secure+sameSite cookies, `npm audit` pre-release.
- Ask First (human approval) — new auth flows, new sensitive-data categories, new external integrations, CORS changes, upload handlers, rate-limit changes, elevated perms/roles.
- Never Do — commit secrets, log sensitive data, trust client-side validation, disable headers, `eval()`/`innerHTML` on user data, auth tokens in localStorage, expose stack traces.

## OWASP Top 10 Prevention Patterns
- Injection — parameterized queries (`$1`), never string-concat.
- Broken auth — bcrypt salt rounds 12; session secret from env; cookie httpOnly/secure/sameSite:'lax', maxAge 24h.
- XSS — framework auto-escaping; `DOMPurify.sanitize()` if HTML required.
- Broken access control — check authorization, not just auth; ownership check → 403 FORBIDDEN.
- Misconfiguration — `helmet()`; CSP directives; CORS origin allowlist + credentials.
- Sensitive data exposure — `sanitizeUser()` strips passwordHash/resetToken; secrets from env, fail-fast.
- SSRF — allowlist scheme+host, resolve ALL records, `ipaddr range() !== 'unicast'` (catches 169.254.169.254 metadata), `redirect: 'error'`. TOCTOU gap — fetch re-resolves DNS; high-risk → pin IP or filtering agent.

## Input Validation Patterns
- Schema at boundary — zod `safeParse` → 422 VALIDATION_ERROR + flatten.
- File uploads — allowlist mimetypes, 5MB max; don't trust extension, check magic bytes.

## Triaging npm audit Results
- critical/high reachable → fix immediately; dev-only → fix soon. Moderate → next release; low → backlog. Deferred fix → document reason + review date.
- Supply chain — commit lockfile, `npm ci` in CI, review new deps (A06/LLM03), beware `postinstall` scripts, watch typosquats.

## Rate Limiting
- General `/api/` — 15min window, max 100. Auth `/api/auth/` — 15min, max 10.

## Secrets Management
- Commit `.env.example` only; gitignore `.env`, `.env.local`, `*.pem`, `*.key`. Pre-commit `git diff --cached | grep -i "password\|secret\|api_key\|token"`. Committed = compromised → revoke + reissue, then purge history.

## Securing AI / LLM Features
- LLM output = untrusted input (LLM05) — never into eval/SQL/shell/innerHTML/file path. Prompt injection (LLM01) — system prompt not a security boundary; perms in code.
- Keep secrets + other users' data out of prompts (LLM02/07); constrain tool perms (LLM06); cap tokens/rate/loops (LLM10); vector store = trust boundary, tenant-partitioned (LLM08).
- Good pattern — `JSON.parse` → schema → allowlisted action; `textContent`, not `innerHTML`.

## Security Review Checklist
- Sections — Authentication, Authorization, Input, Data, Infrastructure, Supply Chain, AI/LLM. Salt ≥12, httpOnly/secure/sameSite, rate-limited login, per-endpoint authz, own-resource-only, validated input, parameterized SQL, encoded HTML, allowlisted URL fetches, no secrets, PII encrypted, headers, restricted CORS, audited deps, generic errors, lockfile + `npm ci`, LLM output untrusted.

## Common Rationalizations
- "Internal tool" — internal tools get compromised. "Add security later" — retrofit 10x harder. "Framework handles security" — tools, not guarantees. "Just a prototype" — becomes production. "Just LLM output" — can be SQL/script tag/shell command.

## Red Flags
- Input → queries/shell/HTML; secrets in code/history; endpoints without auth; wildcard CORS; no auth rate limit; stack traces exposed; critical vulns; SSRF-unprotected fetches; LLM output into query/DOM/shell/eval.

## Verification
- `npm audit` no critical/high; no secrets in code/history; input validated at boundaries; auth+authz on every endpoint; headers present; generic errors; auth rate limiting; allowlisted URL fetches; LLM output validated.
