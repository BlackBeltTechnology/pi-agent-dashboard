/**
 * T.70 (harden-agent-tool-guards D3, test-plan #E71): every pi spawn road into the same unpinned
 * clone yields argv/env identical on the TRUST axis. The rule lives in the bridge, so no road may
 * add a trust flag (`--approve` / `--no-approve`), a trust env var or a spawn-record field; the only
 * place that may emit `--no-approve` is a plugin's own tighter scope (team personas), never a
 * relaxing one. ACP starts no pi bridge and is excluded.
 */
import fs from "node:fs";
import path from "node:path";
import { type SessionFlags, sessionFlagsToArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

const CLONE = "/w/clone";
// One SessionFlags per road; none sets a trust field. Shapes mirror what each road builds.
const ROADS: Array<[string, SessionFlags]> = [
  ["MCP spawn_session", {}],
  ["REST POST /api/session/spawn", {}],
  ["WS spawn_session", {}],
  ["automation", { model: "m" }],
  ["goal", { model: "m", thinking: "low" }],
  ["/new (continue)", { mode: "continue", sessionFile: "/s/a.jsonl" }],
  ["worktree", {}],
  ["subfolder", {}],
];

describe("T.70 spawn roads are identical on the trust axis", () => {
  for (const [road, flags] of ROADS) {
    it(road, () => {
      const argv = sessionFlagsToArgv(flags);
      expect(argv).not.toContain("--approve");
      expect(argv).not.toContain("--no-approve");
      const env = buildSpawnEnv({ PATH: "/usr/bin" }, { cwd: CLONE, spawnToken: "tok" });
      expect(Object.keys(env).filter((k) => /TRUST|APPROVE/i.test(k))).toEqual([]);
    });
  }

  it("the argv/env of any two roads match on the trust axis (same inputs → same bytes)", () => {
    const a = sessionFlagsToArgv({});
    const b = sessionFlagsToArgv({ mode: "continue", sessionFile: "/s/a.jsonl" });
    expect(a.filter((x) => /approve/.test(x))).toEqual(b.filter((x) => /approve/.test(x)));
  });

  /**
   * @structural-pin stays-gone guard: no server source may set `noProjectTrust: true`; absence of that text is the contract (only a plugin's own tighter scope, e.g. team personas, may)
   */
  it("no server source sets `noProjectTrust` (only a plugin's own tighter scope may)", () => {
    const hits = sourcesSettingNoProjectTrust(path.resolve(__dirname, ".."));
    expect(hits).toEqual([]);
  });
});

/** Non-test server sources that set `noProjectTrust: true`. */
function sourcesSettingNoProjectTrust(dir: string): string[] {
  const hits: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") hits.push(...sourcesSettingNoProjectTrust(p));
    } else if (e.name.endsWith(".ts") && /noProjectTrust\s*[:=]\s*true/.test(fs.readFileSync(p, "utf8"))) {
      hits.push(p);
    }
  }
  return hits;
}
