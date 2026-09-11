/**
 * Dashboard-registered tools are cwd-INDEPENDENT (test-plan #X7).
 *
 * pi 0.85.1 made its BUILT-IN `bash`/`edit`/`find`/`grep`/`ls`/`read`/`write`
 * tools honour `ctx.cwd` instead of ignoring it. The dashboard's own
 * registered tools were audited against the same defect class (task 5.1):
 * none of `ask_user`, `canvas`, or the role/model tools resolves a filesystem
 * path or spawns a process, so there is nothing to anchor to `ctx.cwd`. This
 * test RECORDS that independence and fails if a future edit introduces a
 * cwd-sensitive call into one of them.
 *
 * See change: update-pi-core-0-85-adopt-apis (task 5.1/5.2, design §Decision).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The three dashboard tools named by the cwd audit (task 5.1). */
const TOOLS = ["ask-user-tool.ts", "canvas-tool.ts", "role-model-tools.ts"] as const;

/** APIs a path-resolving / process-spawning tool would have to use. */
const CWD_SENSITIVE_APIS = [
	"process.cwd(",
	"child_process",
	"spawnSync",
	"spawn(",
	"fs.readFile",
	"fs.writeFile",
	"fs.readdir",
	"readFileSync",
	"writeFileSync",
] as const;

describe("X7: dashboard tools are recorded cwd-independent", () => {
	it.each(TOOLS)("%s resolves no path and spawns no process", (file) => {
		const src = fs.readFileSync(path.join(here, "..", file), "utf8");
		for (const needle of CWD_SENSITIVE_APIS) {
			expect(src, `${file} must not call ${needle}`).not.toContain(needle);
		}
	});
});
