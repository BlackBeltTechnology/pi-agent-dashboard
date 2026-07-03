# implement/scripts/parse-findings.ts — index

Pure parsing helpers for CodeRabbit `--agent` NDJSON. Exports `parseFindings(stdout)` → `Finding[]` (filters `type === 'finding'`), `splitFindings(findings)` → `{all, mustFix}` (MUST_FIX = `/critical|major|high|warn|error/i`). Type `Finding = {type?, severity?, comment?, codegenInstructions?}`. Unit-testable extraction from `review-changes.ts`.
