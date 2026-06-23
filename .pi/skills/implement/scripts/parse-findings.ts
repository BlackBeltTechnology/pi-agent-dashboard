/**
 * Pure parsing helpers for CodeRabbit `--agent` NDJSON output.
 * Extracted from review-changes.ts so it can be unit-tested.
 */
export type Finding = { type?: string; severity?: string; comment?: string; codegenInstructions?: string };

const MUST_FIX = /critical|major|high|warn|error/i;

/** Parse the `--agent` NDJSON stream into `finding` events. Skips non-JSON lines. */
export function parseFindings(stdout: string): Finding[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Finding;
      } catch {
        return null;
      }
    })
    .filter((o): o is Finding => o?.type === 'finding');
}

/** Split findings into Critical/Warning (must-fix) vs the rest by severity. */
export function splitFindings(findings: Finding[]): { all: Finding[]; mustFix: Finding[] } {
  return { all: findings, mustFix: findings.filter((f) => MUST_FIX.test(f.severity ?? '')) };
}
