import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigPartial } from "../config-api.js";
import { livePublicBaseUrls, resetConfigSnapshot } from "../config-snapshot.js";

/**
 * `allowedHosts` / `hostGate` partial writes + legacy publicBaseUrls live read
 * (test-plan #E11 write half, #E12, #E7). See change: add-host-allowlist-admission.
 */

let dir: string;
let file: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-api-host-gate-"));
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  file = path.join(dir, ".pi", "dashboard", "config.json");
  origHome = process.env.HOME!;
  process.env.HOME = dir;
  resetConfigSnapshot();
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
  resetConfigSnapshot();
});

function write(value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value));
}

function read(): any {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

describe("#E11 writeConfigPartial hostGate", () => {
  it("writes hostGate whole and leaves other keys intact", () => {
    write({ auth: { secret: "s" }, allowedHosts: ["a"], hostGate: { mode: "report" } });
    const result = writeConfigPartial({ hostGate: { mode: "enforce" } });
    expect(result.success).toBe(true);
    const raw = read();
    expect(raw.hostGate.mode).toBe("enforce");
    expect(raw.auth.secret).toBe("s");
    expect(raw.allowedHosts).toEqual(["a"]);
  });
});

describe("#E12 allowedHosts preservation / replacement", () => {
  it("an unrelated write preserves it; an explicit write replaces it whole", () => {
    write({ allowedHosts: ["a"] });
    writeConfigPartial({ auth: { bypassUrls: ["/x"] } });
    expect(read().allowedHosts).toEqual(["a"]);
    writeConfigPartial({ allowedHosts: ["b"] });
    expect(read().allowedHosts).toEqual(["b"]);
  });
});

describe("#E7 legacy pairing.publicBaseUrls is honoured by the live read", () => {
  it("falls back to pairing.publicBaseUrls when the top-level key is absent", () => {
    write({ pairing: { publicBaseUrls: ["https://old.example.com"] } });
    resetConfigSnapshot();
    expect(livePublicBaseUrls()).toEqual(["https://old.example.com"]);
  });
});
