// Guarded postinstall: the openforms-mui skill ships a self-contained Vite
// library under .pi/skills/openforms-mui/tools with its OWN package.json. That
// nested dir is NOT an npm-workspace member, so a monorepo-root `npm install`
// never installs its deps. Install them here — but ONLY when missing, so this
// is a cheap no-op on every subsequent install (no churn in the dashboard
// monorepo dev loop). The bpmn skill is buildless/offline and needs nothing.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(here, "..", ".pi", "skills", "openforms-mui", "tools");
const marker = join(toolsDir, "node_modules", ".package-lock.json");

if (!existsSync(join(toolsDir, "package.json"))) {
  console.log("[pi-forms-bpmn] openforms tools/ not found — skipping.");
  process.exit(0);
}
if (existsSync(marker)) {
  // Already installed — nothing to do.
  process.exit(0);
}

console.log("[pi-forms-bpmn] installing openforms-mui/tools dependencies (one-time)…");
try {
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", toolsDir], {
    stdio: "inherit",
  });
} catch (e) {
  console.warn(
    "[pi-forms-bpmn] openforms tools install failed; run it manually with:\n" +
      `  npm --prefix "${toolsDir}" install\n` +
      String(e?.message ?? e),
  );
  // Do not fail the whole install — the bpmn skill still works offline.
  process.exit(0);
}
