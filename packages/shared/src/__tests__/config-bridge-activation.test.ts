import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureConfig, loadConfig, resolveBridgeEnabled } from "../config.js";

/**
 * `bridge.enabled` config field + `PI_DASHBOARD_BRIDGE` env resolution
 * (test-plan #E1–#E7). See change: add-bridge-env-opt-out.
 */

const on = { enabled: true };
const off = { enabled: false };

describe("#E1 falsy env disables regardless of config", () => {
  for (const v of ["off", " OFF ", "0", "false", "No"]) {
    it(`env ${JSON.stringify(v)} → false`, () => {
      expect(resolveBridgeEnabled(on, { PI_DASHBOARD_BRIDGE: v })).toBe(false);
    });
  }
});

describe("#E2 truthy env enables regardless of config", () => {
  for (const v of ["on", "1", "TRUE", " yes "]) {
    it(`env ${JSON.stringify(v)} → true`, () => {
      expect(resolveBridgeEnabled(off, { PI_DASHBOARD_BRIDGE: v })).toBe(true);
    });
  }
});

describe("#E3 unset / empty env defers to config", () => {
  for (const v of [undefined, "", "  "]) {
    for (const cfg of [on, off]) {
      it(`env ${JSON.stringify(v)} × enabled=${cfg.enabled} → ${cfg.enabled}`, () => {
        expect(resolveBridgeEnabled(cfg, { PI_DASHBOARD_BRIDGE: v })).toBe(cfg.enabled);
      });
    }
  }
});

describe("#E4 near-miss tokens are not recognised", () => {
  for (const v of ["offf", "disabled", "n", "2", "o n"]) {
    for (const cfg of [on, off]) {
      it(`env ${JSON.stringify(v)} × enabled=${cfg.enabled} → ${cfg.enabled}`, () => {
        expect(resolveBridgeEnabled(cfg, { PI_DASHBOARD_BRIDGE: v })).toBe(cfg.enabled);
      });
    }
  }
});

describe("bridge.enabled loader", () => {
  let dir: string;
  let origHome: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-bridge-"));
    origHome = process.env.HOME!;
    process.env.HOME = dir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cfgFile = () => path.join(dir, ".pi", "dashboard", "config.json");
  function writeRaw(raw: string): void {
    fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
    fs.writeFileSync(cfgFile(), raw);
  }

  describe("#E5 field partitions", () => {
    const cases: Array<[string, unknown, boolean]> = [
      ["absent", undefined, true],
      ["{}", {}, true],
      ["{enabled:false}", { enabled: false }, false],
      ['{enabled:"no"}', { enabled: "no" }, true],
      ["{enabled:0}", { enabled: 0 }, true],
      ["null", null, true],
      ["bare false", false, true],
    ];
    for (const [label, bridge, expected] of cases) {
      it(`bridge ${label} → enabled=${expected}`, () => {
        writeRaw(JSON.stringify(bridge === undefined ? {} : { bridge }));
        expect(loadConfig().bridge.enabled).toBe(expected);
      });
    }
  });

  describe("#E6 unreadable file defaults to enabled", () => {
    it("missing file", () => {
      expect(loadConfig().bridge.enabled).toBe(true);
    });
    it("empty file", () => {
      writeRaw("");
      expect(loadConfig().bridge.enabled).toBe(true);
    });
    it("malformed JSON", () => {
      writeRaw("{not json");
      expect(loadConfig().bridge.enabled).toBe(true);
    });
  });

  it("#E7 ensureConfig does not seed bridge", () => {
    ensureConfig();
    const raw = JSON.parse(fs.readFileSync(cfgFile(), "utf-8"));
    expect(raw.bridge).toBeUndefined();
  });
});
