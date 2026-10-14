import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureConfig, loadConfig } from "../config.js";

/**
 * `pairing.acceptLanRequests` loader (test-plan #E1).
 * See change: add-lan-knock-pairing.
 */

let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-pairing-"));
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

describe("#E1 pairing.acceptLanRequests loader", () => {
  it("absent defaults to false", () => {
    write({});
    expect(loadConfig().pairing.acceptLanRequests).toBe(false);
    write({ pairing: { publicBaseUrls: [] } });
    expect(loadConfig().pairing.acceptLanRequests).toBe(false);
  });

  it("true is kept", () => {
    write({ pairing: { acceptLanRequests: true } });
    expect(loadConfig().pairing.acceptLanRequests).toBe(true);
  });

  it("a non-boolean coerces to false", () => {
    write({ pairing: { acceptLanRequests: "yes" } });
    expect(loadConfig().pairing.acceptLanRequests).toBe(false);
    write({ pairing: { acceptLanRequests: 1 } });
    expect(loadConfig().pairing.acceptLanRequests).toBe(false);
  });

  it("ensureConfig seeds the default false", () => {
    ensureConfig();
    expect(loadConfig().pairing.acceptLanRequests).toBe(false);
  });
});
