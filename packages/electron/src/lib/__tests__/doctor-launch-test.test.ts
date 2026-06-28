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
import { buildServerLaunchTestCmd } from "../doctor.js";

describe("buildServerLaunchTestCmd", () => {
  const nodeBin = "/bundled/node";
  const jitiUrl = "file:///bundled/jiti-register.mjs";

  // The probe embeds the script inside `-e "..."`, so the inner import quotes
  // are shell-escaped to \". Assert on the unescaped logical `-e` script.
  const unescape = (cmd: string) => cmd.replace(/\\"/g, '"');

  it("never emits a raw Windows drive-letter import (the ERR trigger)", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli: "C:\\Users\\test\\cli.ts" });
    // Bug form was `import "C:\…"` — backslash drive path. Must never appear.
    expect(cmd).not.toContain('import "C:\\');
    expect(cmd).not.toContain("C:\\Users");
    expect(unescape(cmd)).toContain('import "file://');
  });

  it.runIf(process.platform === "win32")("emits file:///C:/… on win32", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli: "C:\\Users\\test\\cli.ts" });
    expect(unescape(cmd)).toContain('import "file:///C:/Users/test/cli.ts"');
  });

  it("emits file:// URL form for a POSIX absolute path", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli: "/Users/test/cli.ts" });
    expect(unescape(cmd)).toContain('import "file:///Users/test/cli.ts"');
    expect(cmd).not.toContain('import "/Users/test');
  });

  it("preserves the node/jiti/setTimeout shell template", () => {
    const cmd = buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli: "/Users/test/cli.ts" });
    expect(cmd).toBe(
      `"${nodeBin}" --import "${jitiUrl}" -e "import \\"file:///Users/test/cli.ts\\"; setTimeout(() => process.exit(0), 100)"`,
    );
  });
});
