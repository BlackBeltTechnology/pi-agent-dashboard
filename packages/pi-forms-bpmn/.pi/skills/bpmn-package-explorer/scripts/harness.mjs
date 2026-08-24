// Tiny shared test harness for the skill's self-tests. No dependencies.
let passed = 0, failed = 0;

export async function t(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n     ${e.message}`); }
}

export function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
