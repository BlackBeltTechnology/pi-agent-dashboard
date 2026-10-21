/**
 * resolvePiShell / isWslLauncherBash — a replica of pi-coding-agent 1.3.0
 * getShellConfig() win32 order (shell.js: Git-for-Windows paths, then the first
 * `where bash.exe` hit; legacy-WSL predicate), over an injected env + fs.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E10–#E14).
 */
import { describe, expect, it } from "vitest";
import { isWslLauncherBash, resolvePiShell } from "../platform/resolve-pi-shell.js";

const existsIn = (present: string[]) => {
  const set = new Set(present.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};

describe("resolvePiShell", () => {
  it("E10: %ProgramFiles%\\Git\\bin\\bash.exe wins over a PATH-first bundled bash", () => {
    const pfBash = "C:\\PF\\Git\\bin\\bash.exe";
    const r = resolvePiShell({
      env: { ProgramFiles: "C:\\PF", PATH: "D:\\res\\git\\usr\\bin;C:\\Windows\\System32" },
      exists: existsIn([pfBash, "D:\\res\\git\\usr\\bin\\bash.exe"]),
    });
    expect(r).toEqual({ path: pfBash, isWslLauncher: false });
  });

  it("E11: env keys matched case-insensitively; ProgramFiles(x86) used when ProgramFiles has no Git", () => {
    const x86Bash = "C:\\PF86\\Git\\bin\\bash.exe";
    const r = resolvePiShell({
      env: { PROGRAMFILES: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", PATH: "C:\\Windows\\System32" },
      exists: existsIn([x86Bash]),
    });
    expect(r?.path).toBe(x86Bash);
  });

  it("E12: no PF Git → first PATH dir containing bash.exe (PATH read case-insensitively)", () => {
    const r = resolvePiShell({
      env: { Path: "A;B;C" },
      exists: existsIn(["B\\bash.exe", "C\\bash.exe"]),
    });
    expect(r).toEqual({ path: "B\\bash.exe", isWslLauncher: false });
  });

  it("E14: a PATH dir with only sh.exe resolves nothing", () => {
    const r = resolvePiShell({ env: { PATH: "D:\\bin" }, exists: existsIn(["D:\\bin\\sh.exe"]) });
    expect(r).toBeNull();
  });

  it("empty ProgramFiles values and empty PATH segments are ignored", () => {
    expect(resolvePiShell({ env: { ProgramFiles: "", PATH: ";;" }, exists: () => true })).toBeNull();
  });

  it("flags the WSL launcher on the resolved path", () => {
    const wsl = "C:\\Windows\\System32\\bash.exe";
    const r = resolvePiShell({ env: { PATH: "C:\\Windows\\System32" }, exists: existsIn([wsl]) });
    expect(r).toEqual({ path: wsl, isWslLauncher: true });
  });
});

describe("isWslLauncherBash", () => {
  it("E13: System32/Sysnative bash.exe (any case, any separator) → true; Git / bundled → false", () => {
    expect(isWslLauncherBash("C:\\Windows\\System32\\bash.exe")).toBe(true);
    expect(isWslLauncherBash("c:/windows/sysnative/BASH.EXE")).toBe(true);
    expect(isWslLauncherBash("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(false);
    expect(isWslLauncherBash("D:\\res\\git\\usr\\bin\\bash.exe")).toBe(false);
  });
});
