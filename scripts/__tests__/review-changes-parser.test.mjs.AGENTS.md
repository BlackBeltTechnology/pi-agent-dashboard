# __tests__/review-changes-parser.test.mjs — index

Vitest unit tests for parseFindings + splitFindings (.pi/skills/implement/scripts/parse-findings.ts). parseFindings keeps only `finding` events, skips non-JSON lines; splitFindings buckets critical/major/warning/error as must-fix.
