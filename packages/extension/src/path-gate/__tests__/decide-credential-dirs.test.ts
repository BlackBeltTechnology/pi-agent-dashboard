/**
 * Agent gate on credential directories and browser profiles (harden-agent-tool-guards D7):
 * a read outside every root asks, marked sensitive, `Allow once`/`Deny` only.
 * Rows T.30–T.32 (gate half), T.36, T.37, T.38, T.77 (test-plan #E30–#E32, #E36–#E38, #E78).
 */
import nodePath from "node:path";
import { forbiddenGrantSubjects, isUngrantableSubject } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import { describe, expect, it } from "vitest";
import { buildOptions, decidePathAccess } from "../decide.js";
import type { ResolveEnv } from "../resolve.js";

const posixEnv = (platform: NodeJS.Platform, home: string, path = nodePath.posix): ResolveEnv => ({
  path,
  platform,
  homeDir: home,
  realpathSync: (p) => p,
  exists: () => false,
  isDirectory: () => false,
});

function gate(platform: NodeJS.Platform, home: string, target: string, over: { caseInsensitive?: boolean } = {}) {
  const fenv = { homedir: home, platform, env: {} as NodeJS.ProcessEnv };
  const path = platform === "win32" ? nodePath.win32 : nodePath.posix;
  const d = decidePathAccess({
    access: "read",
    rawPath: target,
    cwd: platform === "win32" ? "C:\\w\\repo" : "/w/repo",
    roots: { workspace: [platform === "win32" ? "C:\\w\\repo" : "/w/repo"], readOnly: [], readWrite: [], grants: [] },
    sensitiveDirs: forbiddenGrantSubjects(fenv).sensitive,
    isUngrantable: (s) => isUngrantableSubject(s, fenv),
    env: posixEnv(platform, home, path),
    caseInsensitive: over.caseInsensitive ?? platform === "win32",
  });
  const options =
    d.verdict === "ask"
      ? buildOptions({ grantable: d.grantable, sensitive: d.sensitive, storeMatch: true, subject: d.subject }).options
      : [];
  return { d, options };
}
const sensitiveAsk = (r: ReturnType<typeof gate>) => r.d.verdict === "ask" && r.d.sensitive && r.options.join() === "Allow once,Deny";

describe("T.38 targets out of every root", () => {
  it.each(["/h/.aws/credentials", "/h/.config/gh/hosts.yml", "/h/.gnupg/pubring.kbx", "/h/.kube/config", "/h/.docker/config.json", "/h/.netrc"])(
    "%s asks, sensitive, no Always allow",
    (t) => {
      expect(sensitiveAsk(gate("linux", "/h", t)), t).toBe(true);
    },
  );
});

describe("T.30/T.31/T.32 browser profile roots (gate half)", () => {
  it("darwin", () => {
    for (const b of ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware", "Firefox"]) {
      expect(sensitiveAsk(gate("darwin", "/h", `/h/Library/Application Support/${b}/Default/Cookies`)), b).toBe(true);
    }
  });
  it("linux", () => {
    for (const b of [".config/google-chrome", ".config/chromium", ".config/microsoft-edge", ".config/BraveSoftware", ".mozilla"]) {
      expect(sensitiveAsk(gate("linux", "/h", `/h/${b}/Default/Cookies`)), b).toBe(true);
    }
    // an ordinary ~/.config/app file is a plain ask, grantable
    const app = gate("linux", "/h", "/h/.config/app/x.json");
    expect(app.d).toMatchObject({ verdict: "ask", sensitive: false, grantable: true });
  });
  it("win32", () => {
    const home = "C:\\Users\\u";
    for (const b of ["AppData\\Local\\Google\\Chrome\\User Data", "AppData\\Local\\Microsoft\\Edge\\User Data", "AppData\\Local\\BraveSoftware", "AppData\\Roaming\\Mozilla"]) {
      expect(sensitiveAsk(gate("win32", home, `${home}\\${b}\\Default\\Cookies`)), b).toBe(true);
    }
  });
});

describe("T.36 / T.37 netrc boundary", () => {
  it("~/.netrc.bak and ~/.netrc.d/x are not sensitive; ~/.netrc.d/x offers Always allow ~/.netrc.d", () => {
    expect(gate("linux", "/h", "/h/.netrc.bak").d).toMatchObject({ verdict: "ask", sensitive: false });
    const d = gate("linux", "/h", "/h/.netrc.d/x");
    expect(d.d).toMatchObject({ verdict: "ask", sensitive: false });
    expect(d.options).toContain("Always allow /h/.netrc.d…");
    expect(sensitiveAsk(gate("linux", "/h", "/h/.netrc"))).toBe(true);
  });
  it("win32 `_netrc` is not sensitive (recorded residual)", () => {
    expect(gate("win32", "C:\\Users\\u", "C:\\Users\\u\\_netrc").d).toMatchObject({ verdict: "ask", sensitive: false });
  });
});

describe("T.77 case spelling", () => {
  it("~/.AWS/credentials is flagged sensitive with no Always allow on both volume kinds (flagging errs toward flagging)", () => {
    expect(sensitiveAsk(gate("linux", "/h", "/h/.AWS/credentials", { caseInsensitive: true }))).toBe(true);
    expect(sensitiveAsk(gate("linux", "/h", "/h/.AWS/credentials", { caseInsensitive: false }))).toBe(true);
  });
});
