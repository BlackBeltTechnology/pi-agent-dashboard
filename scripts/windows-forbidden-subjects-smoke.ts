/**
 * Windows forbidden-subjects smoke (CI: _smoke.yml standalone-install-smoke-windows).
 *
 * Proves the platform-scoped forbidden grant-subject list on a REAL Windows
 * host (the unit tests can only simulate `platform: "win32"` on POSIX, where no
 * path resolves): the host's own `%SystemRoot%` is listed, and none of the POSIX
 * system directories leak in as drive-rooted junk (`C:\etc`), which would make
 * the both-directions containment rule refuse the wrong directories.
 *
 * Prints every entry. Exit 0 = pass. Off Windows it skips (exit 0): the POSIX
 * half is covered by `ladder-scenarios.test.ts` #E23.
 *
 * See change: surface-denial-remedy-in-previews (test-plan #E24, design D8).
 */
import { forbiddenGrantSubjects } from "../packages/server/src/access/forbidden-subjects.js";

if (process.platform !== "win32") {
  console.log("[forbidden-subjects-smoke] not a Windows host — skipped");
  process.exit(0);
}

const { whole, sensitive } = forbiddenGrantSubjects();
const entries = [...whole, ...sensitive];
for (const e of entries) console.log(`[forbidden-subjects-smoke] ${e}`);

const failures: string[] = [];
const systemRoot = process.env.SystemRoot;
const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
// Listed entries are real paths; compare case-insensitively without a trailing slash.
if (!systemRoot) failures.push("%SystemRoot% is unset on this host");
else if (!entries.some((e) => norm(e) === norm(systemRoot))) {
  failures.push(`%SystemRoot% (${systemRoot}) is not listed`);
}
for (const e of entries) {
  if (e.startsWith("/")) failures.push(`POSIX-rooted entry: ${e}`);
  if (/\\(etc|usr|var)$/i.test(e)) failures.push(`POSIX system directory as junk: ${e}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`[forbidden-subjects-smoke] FAIL: ${f}`);
  process.exit(1);
}
console.log(`[forbidden-subjects-smoke] OK (${entries.length} entries)`);
