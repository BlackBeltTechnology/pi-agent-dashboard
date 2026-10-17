/**
 * The local-IPC token shares ONE HOME root with the rendezvous record and the
 * gateway socket (task 2.0g).
 *
 * See change: add-pi-gateway-transport-identity.
 */
import nodeOs from "node:os";
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// (test-plan #E17) One HOME root for every rendezvous artefact — task 2.0g.
//
// `defaultLocalTokenDir` used `os.homedir()` while the rendezvous record and
// the gateway socket resolve through `dashboard-paths.ts`. Two roots means the
// temp-HOME isolated-verification workflow reads its token from a DIFFERENT
// home than its record — and on Windows an injected `env.homedir` and
// `USERPROFILE` disagree outright.
// ──────────────────────────────────────────────────────────────────────────
describe("local token root (task 2.0g)", () => {
  it("shares the dashboard config root with the rendezvous record", async () => {
    const { getDashboardConfigDir } = await import(
      "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js"
    );
    const { defaultLocalTokenDir } = await import("../auth/local-token.js");
    expect(defaultLocalTokenDir()).toBe(nodePath.join(getDashboardConfigDir(), "local"));
  });

  // The teeth: an INJECTED homedir. `os.homedir()` ignores it, so isolated
  // verification would read the token from the real home while writing its
  // record and socket under the temp one. On Windows the two disagree even
  // without injection (`env.homedir` vs `USERPROFILE`).
  it("honours an injected homedir, exactly as the record and socket do", async () => {
    const { getDashboardConfigDir } = await import(
      "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js"
    );
    const { defaultLocalTokenDir } = await import("../auth/local-token.js");
    const homedir = nodePath.join(nodeOs.tmpdir(), `pi-token-root-${Math.random()}`);
    expect(defaultLocalTokenDir({ homedir })).toBe(
      nodePath.join(getDashboardConfigDir({ homedir }), "local"),
    );
    expect(defaultLocalTokenDir({ homedir }).startsWith(homedir)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (test-plan #X6) `readLocalTokenIfPresent` is read-only: the CLI approval verbs
// must never leave a token file behind on a host where the server never ran.
// See change: fix-pairing-approval-credential (D9).
// ──────────────────────────────────────────────────────────────────────────
describe("readLocalTokenIfPresent (X6)", () => {
  it("returns null for a missing token path and performs zero mkdir / write calls", async () => {
    const nodeFs = (await import("node:fs")).default;
    const { readLocalTokenIfPresent } = await import("../auth/local-token.js");
    const dir = nodePath.join(nodeOs.tmpdir(), `pi-token-absent-${Math.random()}`);
    const mkdir = vi.spyOn(nodeFs, "mkdirSync");
    const write = vi.spyOn(nodeFs, "writeFileSync");
    const chmod = vi.spyOn(nodeFs, "chmodSync");
    try {
      expect(readLocalTokenIfPresent(dir)).toBeNull();
      expect(mkdir).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(chmod).not.toHaveBeenCalled();
      expect(nodeFs.existsSync(dir)).toBe(false);
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
      chmod.mockRestore();
    }
  });

  it("returns the trimmed token when present; null for an empty file or a directory", async () => {
    const nodeFs = (await import("node:fs")).default;
    const { readLocalTokenIfPresent } = await import("../auth/local-token.js");
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "pi-token-read-"));
    try {
      nodeFs.writeFileSync(nodePath.join(dir, "token"), "  secret-token\n");
      expect(readLocalTokenIfPresent(dir)).toBe("secret-token");
      nodeFs.writeFileSync(nodePath.join(dir, "token"), "");
      expect(readLocalTokenIfPresent(dir)).toBeNull();
      nodeFs.rmSync(nodePath.join(dir, "token"));
      nodeFs.mkdirSync(nodePath.join(dir, "token"));
      expect(readLocalTokenIfPresent(dir)).toBeNull();
    } finally {
      nodeFs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
