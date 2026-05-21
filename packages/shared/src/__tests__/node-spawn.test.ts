/**
 * Tests for `platform/node-spawn.ts` — the canonical helper for
 * constructing `node --import <loader> <entry>` argv.
 *
 * See change: fix-windows-entry-script-url.
 */
import { describe, it, expect, vi } from "vitest";
import { toFileUrl, spawnNodeScript, isTsxLoader, shouldUrlWrapEntry } from "../platform/node-spawn.js";
import * as execModule from "../platform/exec.js";

describe("toFileUrl", () => {
  it("returns a file:// URL input unchanged (idempotent)", () => {
    expect(toFileUrl("file:///C:/foo.ts")).toBe("file:///C:/foo.ts");
    expect(toFileUrl("file:///usr/local/bin/cli.js")).toBe("file:///usr/local/bin/cli.js");
  });

  it("wraps Windows B:\\ drive-letter paths on any host OS", () => {
    expect(toFileUrl("B:\\Dev\\cli.ts")).toBe("file:///B:/Dev/cli.ts");
  });

  it("wraps Windows C:\\ drive-letter paths on any host OS", () => {
    expect(toFileUrl("C:\\Users\\x\\cli.ts")).toBe("file:///C:/Users/x/cli.ts");
  });

  it("wraps forward-slash Windows paths", () => {
    expect(toFileUrl("B:/Dev/cli.ts")).toBe("file:///B:/Dev/cli.ts");
  });

  it("wraps POSIX absolute paths", () => {
    expect(toFileUrl("/usr/local/bin/cli.js")).toBe("file:///usr/local/bin/cli.js");
  });

  it("handles uppercase and lowercase drive letters identically", () => {
    expect(toFileUrl("b:\\Dev\\cli.ts")).toBe("file:///b:/Dev/cli.ts");
    expect(toFileUrl("Z:\\foo.ts")).toBe("file:///Z:/foo.ts");
  });
});

describe("isTsxLoader", () => {
  it("returns true for loader URLs containing /tsx/", () => {
    expect(isTsxLoader("file:///home/x/node_modules/tsx/dist/esm/index.mjs")).toBe(true);
    expect(isTsxLoader("file:///C:/project/node_modules/tsx/dist/esm/index.mjs")).toBe(true);
  });

  it("returns true for raw paths with /tsx/ segment", () => {
    expect(isTsxLoader("/home/x/node_modules/tsx/dist/esm/index.mjs")).toBe(true);
  });

  it("returns true for Windows raw paths with \\tsx\\ segment", () => {
    expect(isTsxLoader("C:\\project\\node_modules\\tsx\\dist\\esm\\index.mjs")).toBe(true);
  });

  it("returns false for jiti loader", () => {
    expect(isTsxLoader("file:///home/x/node_modules/@mariozechner/jiti/lib/jiti-register.mjs")).toBe(false);
    expect(isTsxLoader("/home/x/node_modules/@mariozechner/jiti/lib/jiti-register.mjs")).toBe(false);
  });

  it("returns false for undefined / empty", () => {
    expect(isTsxLoader(undefined)).toBe(false);
    expect(isTsxLoader("")).toBe(false);
  });
});

describe("spawnNodeScript", () => {
  it("URL-wraps loader but passes RAW entry when loader is jiti (any platform)", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    spawnNodeScript({
      nodeBin: "C:\\Program Files\\nodejs\\node.exe",
      loader: "B:\\jiti\\lib\\jiti-register.mjs",
      entry: "B:\\Dev\\cli.ts",
      args: ["start", "--dev"],
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [bin, argv] = spawnSpy.mock.calls[0]!;
    expect(bin).toBe("C:\\Program Files\\nodejs\\node.exe");
    // jiti loader → entry RAW everywhere (jiti misnormalises file:///
    // URL entries on Windows; POSIX never needed the wrap).
    expect(argv).toEqual([
      "--import",
      "file:///B:/jiti/lib/jiti-register.mjs",
      "B:\\Dev\\cli.ts",
      "start",
      "--dev",
    ]);

    spawnSpy.mockRestore();
  });

  it("URL-wraps loader but passes RAW entry when loader is tsx", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    spawnNodeScript({
      nodeBin: "/usr/bin/node",
      loader: "/home/u/node_modules/tsx/dist/esm/index.mjs",
      entry: "/home/u/repo/packages/server/src/cli.ts",
      args: ["start"],
    });

    const [, argv] = spawnSpy.mock.calls[0]!;
    expect(argv).toEqual([
      "--import",
      "file:///home/u/node_modules/tsx/dist/esm/index.mjs",
      "/home/u/repo/packages/server/src/cli.ts",  // RAW, not URL
      "start",
    ]);
    spawnSpy.mockRestore();
  });

  it("defaults nodeBin to process.execPath when omitted", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    spawnNodeScript({
      entry: "/usr/local/cli.ts",
    });

    const [bin] = spawnSpy.mock.calls[0]!;
    expect(bin).toBe(process.execPath);
    spawnSpy.mockRestore();
  });

  it("omits --import when no loader is provided", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    spawnNodeScript({
      entry: "B:\\Dev\\cli.ts",
      args: ["help"],
    });

    const [, argv] = spawnSpy.mock.calls[0]!;
    // No loader → shouldUrlWrapEntry returns false on Linux host → raw entry.
    expect(argv).toEqual(["B:\\Dev\\cli.ts", "help"]);
    spawnSpy.mockRestore();
  });

  it("passes spawnOptions through to exec.spawn unchanged", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    const opts = { detached: true, stdio: ["ignore", 1, 2] as ("ignore" | number)[], env: { FOO: "bar" } };
    spawnNodeScript({
      entry: "/usr/local/cli.ts",
      spawnOptions: opts,
    });

    const [, , passedOpts] = spawnSpy.mock.calls[0]!;
    expect(passedOpts).toBe(opts);
    spawnSpy.mockRestore();
  });

  it("accepts a loader that is already a file:// URL without double-wrapping", () => {
    const spawnSpy = vi
      .spyOn(execModule, "spawn")
      .mockImplementation(() => ({ unref: () => {} } as unknown as ReturnType<typeof execModule.spawn>));

    spawnNodeScript({
      loader: "file:///C:/jiti/register.mjs",
      entry: "B:\\Dev\\cli.ts",
    });

    const [, argv] = spawnSpy.mock.calls[0]!;
    // On Linux host with non-tsx loader: entry stays raw.
    expect(argv).toEqual([
      "--import",
      "file:///C:/jiti/register.mjs",
      "B:\\Dev\\cli.ts",
    ]);
    spawnSpy.mockRestore();
  });
});

describe("buildNodeImportArgvParts", () => {
  // Pure helper shared by spawnNodeScript and restart-helper.ts so the
  // `--import` argv shape lives in exactly one place.
  it("POSIX + jiti: entry passed RAW (jiti rejects file:// URL entries)", async () => {
    const { buildNodeImportArgvParts } = await import("../platform/node-spawn.js");
    const parts = buildNodeImportArgvParts({
      loader: "/usr/lib/jiti/lib/jiti-register.mjs",
      entry: "/srv/cli.ts",
      args: ["start", "--port", "8000"],
      platform: "linux",
    });
    expect(parts[0]).toBe("--import");
    expect(parts[1]).toMatch(/^file:\/\//);
    expect(parts[2]).toBe("/srv/cli.ts"); // RAW
    expect(parts.slice(3)).toEqual(["start", "--port", "8000"]);
  });

  it("Windows + jiti: entry passed RAW (jiti misnormalises file:/// URLs on Windows)", async () => {
    // See change: fix-windows-standalone-spawn. Live repro on
    // Win11 + Node 22.18.0 + jiti 2.7.0 showed the URL-wrapped entry
    // re-resolved against cwd; Node's drive-letter heuristic accepts
    // raw `C:\…` argv entries so the wrap is no longer needed.
    const { buildNodeImportArgvParts } = await import("../platform/node-spawn.js");
    const parts = buildNodeImportArgvParts({
      loader: "C:\\Users\\u\\.pi-dashboard\\node_modules\\jiti\\lib\\jiti-register.mjs",
      entry: "C:\\Users\\u\\.pi-dashboard\\node_modules\\@earendil-works\\pi-agent-dashboard\\packages\\server\\src\\cli.ts",
      args: ["start"],
      platform: "win32",
    });
    expect(parts[1]).toBe(
      "file:///C:/Users/u/.pi-dashboard/node_modules/jiti/lib/jiti-register.mjs",
    );
    // Entry is RAW — NOT URL-wrapped — because the loader is jiti.
    expect(parts[2]).toBe(
      "C:\\Users\\u\\.pi-dashboard\\node_modules\\@earendil-works\\pi-agent-dashboard\\packages\\server\\src\\cli.ts",
    );
  });

  it("tsx loader: entry RAW on any platform", async () => {
    const { buildNodeImportArgvParts } = await import("../platform/node-spawn.js");
    const parts = buildNodeImportArgvParts({
      loader: "/x/tsx/dist/esm/index.mjs",
      entry: "C:\\srv\\cli.ts",
      args: [],
      platform: "win32",
    });
    expect(parts[2]).toBe("C:\\srv\\cli.ts"); // RAW (tsx rejects file:// entries)
  });

  it("omits args when none supplied", async () => {
    const { buildNodeImportArgvParts } = await import("../platform/node-spawn.js");
    const parts = buildNodeImportArgvParts({
      loader: "/x/jiti/lib/jiti-register.mjs",
      entry: "/srv/cli.ts",
      platform: "linux",
    });
    expect(parts).toEqual(["--import", `file://${"/x/jiti/lib/jiti-register.mjs"}`, "/srv/cli.ts"]);
  });
});

describe("shouldUrlWrapEntry", () => {
  it("returns false for tsx loader on any platform", () => {
    const tsxLoader = "file:///home/u/node_modules/tsx/dist/esm/index.mjs";
    expect(shouldUrlWrapEntry(tsxLoader, "linux")).toBe(false);
    expect(shouldUrlWrapEntry(tsxLoader, "darwin")).toBe(false);
    expect(shouldUrlWrapEntry(tsxLoader, "win32")).toBe(false);
  });

  it("returns false for non-tsx loader on POSIX (jiti MUST get raw entry)", () => {
    const jiti = "file:///home/u/node_modules/@mariozechner/jiti/lib/jiti-register.mjs";
    expect(shouldUrlWrapEntry(jiti, "linux")).toBe(false);
    expect(shouldUrlWrapEntry(jiti, "darwin")).toBe(false);
  });

  it("returns false for jiti loader on Windows (jiti misnormalises file:/// entries)", () => {
    // See change: fix-windows-standalone-spawn.
    const jiti = "file:///C:/node_modules/@mariozechner/jiti/lib/jiti-register.mjs";
    expect(shouldUrlWrapEntry(jiti, "win32")).toBe(false);
  });

  it("returns true for an unknown loader on Windows (drive-letter URL-scheme protection)", () => {
    // A hypothetical non-tsx, non-jiti loader (or a future Node default
    // resolver) still needs the wrap for edge-case drives like `B:`/`A:`.
    const unknown = "file:///C:/node_modules/some-other-loader/index.mjs";
    expect(shouldUrlWrapEntry(unknown, "win32")).toBe(true);
  });

  it("returns false when no loader is provided, regardless of platform", () => {
    // Without a loader, Node's default resolver handles the entry; the URL
    // wrap was historically used for Windows drive-letter collision, but
    // if we were to spawn without a loader we'd still default to raw on POSIX.
    // On Windows without a loader, callers should wrap themselves.
    expect(shouldUrlWrapEntry(undefined, "linux")).toBe(false);
    expect(shouldUrlWrapEntry(undefined, "darwin")).toBe(false);
  });
});
