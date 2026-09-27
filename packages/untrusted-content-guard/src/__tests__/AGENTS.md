# DOX — packages/untrusted-content-guard/src/__tests__

L1 vitest suites. See change: add-untrusted-content-guard.

| File | Purpose |
|------|---------|
| `extension.test.ts` | Fake-`pi` wiring: run-scope input reset, #E31 session scope + `/guard-clear`, real `tool_result` rewrite, untrusted-project settings ignored. Temp `PI_CODING_AGENT_DIR`. |
| `guard.test.ts` | test-plan #E16 (block), #E22–#E30, #E32–#E34, #X1 against `UntrustedContentGuard`. |
| `scan-perf.test.ts` | #P1: median ≤ 25 ms/100 KB at 500 KB + 1 MB HTML; t(1 MB)/t(500 KB) ≤ 2.5. |
| `scanner-parse-failure.test.ts` | #X3: `vi.mock("htmlparser2")` throws → `html_parse_failed` + plain-text fallback, result still spotlighted. |
| `scanner.test.ts` | #E1–#E21, #X2 exact-equality layer tests (preservation, byte identity, detection rule, size cap). |
