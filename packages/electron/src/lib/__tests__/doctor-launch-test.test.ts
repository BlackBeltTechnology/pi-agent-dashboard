/**
 * Unit tests for buildServerLaunchTestCmd() — the Doctor "Server launch test"
 * probe command builder.
 *
 * Regression: on Windows a raw absolute path (`C:\…\cli.ts`) embedded as a
 * dynamic `import "..."` inside `node -e` is parsed as a URL whose drive letter
 * is treated as a scheme, rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME. The
 * builder MUST emit the `file://` URL form (universal, zero behavioural change
 * on POSIX). See change: fix-doctor-windows-launch-test.
 *
 * Note: `pathToFileURL` is platform-specific — on POSIX a `C:\` input is a
 * relative path (percent-encoded), so the exact `file:///C:/…` string only
 * appears on win32. The cross-platform invariants asserted here: the file
 * scheme is always prepended, and a raw backslash drive-letter import is never
 * emitted (the actual ERR_UNSUPPORTED_ESM_URL_SCHEME trigger).
 */
import { describe, it, expect } from "vitest";
import { buildServerLaunchTestCmd, buildServerLaunchTestEnv, selectServerLaunchTestLoader } from "../doctor.js";

describe("buildServerLaunchTestCmd", () => {
  const nodeBin = "/bundled/node";
  const loaderUrl = "file:///bundled/jiti-register.mjs";

  // The probe embeds the script inside `-e "..."`, so the inner import quotes
  // are shell-escaped to \". Assert on the unescaped logical `-e` script.
  const unescape = (cmd: string) => cmd.replace(/\\"/g, '"');

  it("never emits a raw Windows drive-letter import (the ERR trigger)", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, loaderUrl, testCli: "C:\\Users\\test\\cli.ts" });
    // Bug form was `import "C:\…"` — backslash drive path. Must never appear.
    expect(cmd).not.toContain('import "C:\\');
    expect(cmd).not.toContain("C:\\Users");
    expect(unescape(cmd)).toContain('import "file://');
  });

  it.runIf(process.platform === "win32")("emits file:///C:/… on win32", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, loaderUrl, testCli: "C:\\Users\\test\\cli.ts" });
    expect(unescape(cmd)).toContain('import "file:///C:/Users/test/cli.ts"');
  });

  it("emits file:// URL form for a POSIX absolute path", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, loaderUrl, testCli: "/Users/test/cli.ts" });
    expect(unescape(cmd)).toContain('import "file:///Users/test/cli.ts"');
    expect(cmd).not.toContain('import "/Users/test');
  });

  it("preserves the node/jiti/setTimeout shell template", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, loaderUrl, testCli: "/Users/test/cli.ts" });
    expect(cmd).toBe(
      `"${nodeBin}" --import "${loaderUrl}" -e "import \\"file:///Users/test/cli.ts\\"; setTimeout(() => process.exit(0), 100)"`,
    );
  });
});

describe("buildServerLaunchTestEnv (#720)", () => {
  const pathKeys = (env: NodeJS.ProcessEnv) => Object.keys(env).filter((k) => k.toUpperCase() === "PATH");

  it("E26a: prepends the bundled node dir with ':' on darwin", () => {
    const env = buildServerLaunchTestEnv("/b/node", { PATH: "/usr/bin" }, "darwin");
    expect(env.PATH).toBe("/b:/usr/bin");
  });

  it("E26b: on win32 a Path-keyed env yields a single ';'-joined PATH", () => {
    const env = buildServerLaunchTestEnv("C:\\b\\node.exe", { Path: "C:\\Git\\cmd" }, "win32");
    expect(pathKeys(env)).toEqual(["PATH"]);
    expect(env.PATH).toBe("C:\\b;C:\\Git\\cmd");
  });
});

/**
 * E30 (Electron half) — the Server launch test probes with the SELECTED
 * loader: native by default (no "No jiti loader" even when jiti is absent);
 * the jiti opt-in keeps today's "No jiti loader (install pi)".
 * See change: fix-appimage-cold-boot-latency (design D4).
 */
describe("selectServerLaunchTestLoader (E30)", () => {
  const NATIVE = "file:///b/pi-dashboard-shared/src/platform/native-ts-register.mjs";
  const deps = (env: NodeJS.ProcessEnv) => ({ env, resolveJiti: () => null, resolveNative: () => NATIVE });

  it("env unset + no jiti → native probe, nothing missing", () => {
    const sel = selectServerLaunchTestLoader(deps({}));
    expect(sel).toEqual({ loaderUrl: NATIVE, missing: null });
    const cmd = buildServerLaunchTestCmd({ nodeBin: "/b/node", loaderUrl: sel.loaderUrl!, testCli: "/b/cli.ts" });
    expect(cmd).toContain(`--import "${NATIVE}"`);
    expect(cmd).not.toMatch(/jiti/);
  });

  it("a native register that cannot be located becomes a missing component, not a throw", () => {
    const sel = selectServerLaunchTestLoader({
      env: {},
      resolveJiti: () => null,
      resolveNative: () => { throw new Error("cannot locate native-ts-register.mjs"); },
    });
    expect(sel.loaderUrl).toBeNull();
    expect(sel.missing).toMatch(/No native TypeScript loader/);
  });

  it("jiti opt-in + no jiti → 'No jiti loader (install pi)'", () => {
    expect(selectServerLaunchTestLoader(deps({ PI_DASHBOARD_TS_LOADER: "jiti" }))).toEqual({
      loaderUrl: null,
      missing: "No jiti loader (install pi)",
    });
  });
});
