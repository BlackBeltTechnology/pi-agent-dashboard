/**
 * Producer version floor (test-plan #F6). The plugin surfaces an outdated
 * producer the same way every other plugin surfaces an unmet requirement: it
 * declares it in its manifest `requires`, the loader's requirement probe lists
 * the unmet range in `missingRequirements`, and the shell's Plugins / Add-ons
 * surfaces render it. The plugin itself carries no notice and reads no status.
 *
 * See change: move-subagents-to-plugin (D9).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { missingFromReport, runRequirementProbesFor } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expect, it } from "vitest";

const PRODUCER = "@blackbelt-technology/pi-dashboard-subagents";
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));
const requires = pkg["pi-dashboard-plugin"].requires;

describe("subagents plugin — producer floor via manifest requires (#F6)", () => {
  it("declares the producer and its >=0.7.0 floor in the manifest", () => {
    expect(requires.piExtensions).toContain(PRODUCER);
    expect(requires.piExtensionVersions).toEqual({ [PRODUCER]: ">=0.7.0" });
  });

  it("a 0.6.0 producer is listed in missingRequirements with the unmet range", async () => {
    const report = await runRequirementProbesFor(requires, {
      listInstalled: async () => [{ name: PRODUCER }],
      readInstalledVersion: async () => "0.6.0",
    });
    expect(missingFromReport(report)).toEqual([`${PRODUCER} >=0.7.0`]);
  });

  it("a 0.7.0 producer leaves nothing missing", async () => {
    const report = await runRequirementProbesFor(requires, {
      listInstalled: async () => [{ name: PRODUCER }],
      readInstalledVersion: async () => "0.7.0",
    });
    expect(missingFromReport(report)).toEqual([]);
  });
});
