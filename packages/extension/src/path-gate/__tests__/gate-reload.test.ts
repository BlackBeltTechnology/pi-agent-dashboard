/**
 * TOOL-03 pin (harden-agent-tool-guards D8, T.86, test-plan #E88): the gate's live toggle is NOT pinned.
 * `agentPathGate:{enabled:false}` written to the dashboard config disables the gate from the very next call
 * and restoring it re-enables it (the Settings switch depends on it); `bash` stays out of scope, and a `write`
 * of `~/.pi/dashboard/config.json` still asks as a sensitive location. D8 hands the pinning question to a
 * supervised-mode change: no pinning is added here.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { forbiddenGrantSubjects, isUngrantableSubject } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptBus } from "../../prompt-bus.js";
import { decidePathAccess } from "../decide.js";
import { createPathGate } from "../index.js";
import { Suppression } from "../suppression.js";

let tmp: string;
let cfgFile: string;
let enabled: boolean;
let logs: string[];
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-reload-")));
  cfgFile = nodePath.join(tmp, "config.json");
  fs.writeFileSync(cfgFile, "{}");
  enabled = true;
  logs = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function gate() {
  const cwd = nodePath.join(tmp, "repo");
  fs.mkdirSync(cwd, { recursive: true });
  return createPathGate({
    getSessionId: () => "S1",
    getPromptBus: () => new PromptBus({ timeoutMs: -1 }),
    send: () => false,
    readConfig: () => ({ enabled, timeoutSeconds: 120 }),
    configFile: cfgFile,
    getCwd: () => cwd,
    getSessionDir: () => undefined,
    log: (l) => logs.push(l),
    suppression: new Suppression(),
  });
}
const readOutside = (g: ReturnType<typeof gate>, p: string, tool = "read") =>
  g.handler({ toolName: tool, toolCallId: "tc", input: { path: p, content: "x" } } as never, { hasUI: false, cwd: nodePath.join(tmp, "repo") } as never);

describe("T.86 gate disables and re-enables live; config writes stay sensitive", () => {
  it("toggles on a config-file signature change with no pinning", async () => {
    const g = gate();
    // Outside every root: a real directory in the source tree (the test HOME and tmpdir are rooted).
    const outside = nodePath.join(fs.realpathSync(nodePath.resolve(__dirname, "../../../..")), "src", "bridge.ts");
    expect(await readOutside(g, outside)).toMatchObject({ block: true }); // enabled: out-of-root, no UI → blocked

    enabled = false;
    fs.writeFileSync(cfgFile, JSON.stringify({ agentPathGate: { enabled: false } }));
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(cfgFile, future, future);
    expect(await readOutside(g, outside)).toBeUndefined(); // disabled live

    enabled = true;
    fs.writeFileSync(cfgFile, "{}");
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(cfgFile, later, later);
    expect(await readOutside(g, outside)).toMatchObject({ block: true }); // re-enabled live
  });

  it("a write of ~/.pi/dashboard/config.json still asks as a sensitive location (decision level)", () => {
    const fenv = { homedir: "/h", platform: "linux" as const, env: {} as NodeJS.ProcessEnv };
    const d = decidePathAccess({
      access: "write",
      rawPath: "/h/.pi/dashboard/config.json",
      cwd: "/w/repo",
      roots: { workspace: ["/w/repo"], readOnly: [], readWrite: [], grants: [] },
      sensitiveDirs: forbiddenGrantSubjects(fenv).sensitive,
      isUngrantable: (s) => isUngrantableSubject(s, fenv),
      env: { path: nodePath.posix, platform: "linux", homeDir: "/h", realpathSync: (p) => p, exists: () => false, isDirectory: () => false },
      caseInsensitive: false,
    });
    expect(d).toMatchObject({ verdict: "ask", sensitive: true, grantable: false });
  });
});
