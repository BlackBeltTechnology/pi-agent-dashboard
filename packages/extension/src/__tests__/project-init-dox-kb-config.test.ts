/**
 * DOX kb-config fragment validates against the kb config schema + idempotent write.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DOX_KB_CONFIG, writeDoxKbConfig, kbConfigPath } from "../project-init/dox-kb-config.js";
// Pure config module (node fs/os/path only) — safe to import in the node test env.
import { validateConfig } from "../../../kb/src/config.js";

describe("project-init dox kb config", () => {
  it("validates against the kb config schema with the toolset enabled", () => {
    // The fragment is a partial (nested directoryLevelAgents fields are filled
    // by validateConfig's merge); cast through unknown for the strict param type.
    const merged = validateConfig(DOX_KB_CONFIG as unknown as Parameters<typeof validateConfig>[0]);
    expect(merged.indexAgentsFiles).toBe(true);
    expect(merged.directoryLevelAgents.enabled).toBe(true);
  });

  describe("writeDoxKbConfig", () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-doxkb-")); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("writes the config when absent and validates the written file", () => {
      const res = writeDoxKbConfig(tmp);
      expect(res.written).toBe(true);
      const written = JSON.parse(fs.readFileSync(kbConfigPath(tmp), "utf8"));
      const merged = validateConfig(written);
      expect(merged.indexAgentsFiles).toBe(true);
      expect(merged.directoryLevelAgents.enabled).toBe(true);
    });

    it("is idempotent — leaves an existing config untouched", () => {
      fs.mkdirSync(path.dirname(kbConfigPath(tmp)), { recursive: true });
      fs.writeFileSync(kbConfigPath(tmp), '{"sources":[]}\n');
      const res = writeDoxKbConfig(tmp);
      expect(res.written).toBe(false);
      expect(fs.readFileSync(kbConfigPath(tmp), "utf8")).toBe('{"sources":[]}\n');
    });

    it("overwrite:true rewrites an existing config", () => {
      fs.mkdirSync(path.dirname(kbConfigPath(tmp)), { recursive: true });
      fs.writeFileSync(kbConfigPath(tmp), '{"sources":[]}\n');
      const res = writeDoxKbConfig(tmp, { overwrite: true });
      expect(res.written).toBe(true);
      const written = JSON.parse(fs.readFileSync(kbConfigPath(tmp), "utf8"));
      expect(written.indexAgentsFiles).toBe(true);
    });
  });
});
