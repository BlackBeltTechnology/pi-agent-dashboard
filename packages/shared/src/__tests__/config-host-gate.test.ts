import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureConfig, loadConfig, parseHostGateMode } from "../config.js";

/**
 * `allowedHosts` / `hostGate` config loader (test-plan #E10, #E11 loader half).
 * See change: add-host-allowlist-admission.
 */

let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-host-gate-"));
  origHome = process.env.HOME!;
  process.env.HOME = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("#E10 allowedHosts loader", () => {
  it("absent field defaults to []", () => {
    write({});
    expect(loadConfig().allowedHosts).toEqual([]);
  });

  it("drops non-string entries", () => {
    write({ allowedHosts: ["dash.home.arpa", 42, null] });
    expect(loadConfig().allowedHosts).toEqual(["dash.home.arpa"]);
  });

  it("ensureConfig does not seed allowedHosts or hostGate", () => {
    ensureConfig();
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, ".pi", "dashboard", "config.json"), "utf-8"),
    );
    expect(raw.allowedHosts).toBeUndefined();
    expect(raw.hostGate).toBeUndefined();
  });
});

describe("#E11 hostGate loader", () => {
  // test-plan #E33: absent key loads as enforce (harden-server-request-surfaces)
  it("absent object → enforce", () => {
    write({});
    expect(loadConfig().hostGate.mode).toBe("enforce");
  });

  it("unrecognised mode → report", () => {
    write({ hostGate: { mode: "yes" } });
    expect(loadConfig().hostGate.mode).toBe("report");
  });

  it("enforce is preserved", () => {
    write({ hostGate: { mode: "enforce" } });
    expect(loadConfig().hostGate.mode).toBe("enforce");
  });

  // test-plan #E34
  it("explicit report survives a round-trip", () => {
    write({ hostGate: { mode: "report" } });
    expect(loadConfig().hostGate.mode).toBe("report");
  });

  // test-plan #E33b: the three early returns hand back DEFAULTS wholesale
  it("no config.json → enforce", () => {
    expect(loadConfig().hostGate.mode).toBe("enforce");
  });

  it("empty / whitespace config.json → enforce", () => {
    fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), "  \n ");
    expect(loadConfig().hostGate.mode).toBe("enforce");
  });

  it("malformed-JSON config.json → enforce (fail-closed)", () => {
    fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), "{not json");
    expect(loadConfig().hostGate.mode).toBe("enforce");
  });
});

// test-plan #E32
describe("#E32 parseHostGateMode decision table", () => {
  it.each([
    [undefined, "enforce"],
    ["report", "report"],
    ["enforce", "enforce"],
    ["yes", "report"],
    [123, "report"],
    [null, "report"],
  ] as const)("%s → %s", (raw, expected) => {
    expect(parseHostGateMode(raw)).toBe(expected);
  });

  it("absentDefault override pins the absent arm only", () => {
    expect(parseHostGateMode(undefined, "report")).toBe("report");
    expect(parseHostGateMode("yes", "enforce")).toBe("report");
  });
});
