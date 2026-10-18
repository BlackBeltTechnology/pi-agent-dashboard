// Deliberately imported by NO test anywhere in the repository. The coverage
// scenario (coverage-report.test.mjs E2) proves a source file in scope that no
// test loads is reported at 0% with its lines counted, so this file must STAY
// unloaded: coverage-config.test.mjs fails when anything outside this fixture
// imports it. See change: triage-browser-e2e-offbox-poison (design D5).
export function neverCalled(input: number): number {
  const doubled = input * 2;
  if (doubled > 10) {
    return doubled - 10;
  }
  return doubled;
}

export function alsoNeverCalled(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? "anonymous" : trimmed;
}
