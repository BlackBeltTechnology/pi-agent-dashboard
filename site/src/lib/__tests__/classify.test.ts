import { describe, it, expect } from "vitest";
import { classify } from "~/lib/github-release";

describe("github-release classify()", () => {
  it("routes NSIS Setup.exe to Windows Installer at priority 0 (both arches)", () => {
    for (const arch of ["x64", "arm64"]) {
      expect(classify(`PI-Dashboard-Setup-0.5.5-${arch}.exe`)).toEqual({
        platform: "windows",
        kind: "Installer (.exe)",
        priority: 0,
      });
    }
  });

  it("still classifies Windows ZIP per arch", () => {
    expect(classify("PI-Dashboard-win32-x64.zip")?.kind).toBe("Windows ZIP (x64)");
    expect(classify("PI-Dashboard-win32-arm64.zip")?.kind).toBe("Windows ZIP (arm64)");
  });

  it("does NOT route a non-setup .exe (dropped portable) to the installer bucket", () => {
    const r = classify("PI-Dashboard-x64-portable.exe");
    expect(r?.kind).toBe("Windows .exe");
    expect(r?.priority).not.toBe(0);
  });

  it("returns null for unknown assets", () => {
    expect(classify("README.md")).toBeNull();
  });
});
