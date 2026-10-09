// Stub `npm view <name>@<version> version` for assert-bundled-plugins-published
// CLI tests: every package resolves except those in RUNTIME_GATE_STUB_MISSING
// (comma-separated). See change: electron-runtime-release-pipeline (task 2.5).
export async function view(name, version) {
  const missing = (process.env.RUNTIME_GATE_STUB_MISSING ?? "").split(",").filter(Boolean);
  if (missing.includes(name)) throw new Error(`E404 ${name}@${version}`);
  return version;
}
