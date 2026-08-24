/**
 * The local-IPC token shares ONE HOME root with the rendezvous record and the
 * gateway socket (task 2.0g).
 *
 * See change: add-pi-gateway-transport-identity.
 */
import nodeOs from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

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
