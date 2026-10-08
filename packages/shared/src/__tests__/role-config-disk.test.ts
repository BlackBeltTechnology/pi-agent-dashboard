import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRoleConfigFromDisk } from "../role-config-disk.js";

function home(content?: string): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "rcd-"));
  if (content !== undefined) {
    fs.mkdirSync(path.join(h, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(path.join(h, ".pi", "agent", "providers.json"), content);
  }
  return h;
}

describe("readRoleConfigFromDisk", () => {
  it("reads roles", () => {
    expect(readRoleConfigFromDisk(home('{"roles":{"fast":"a/b"}}')).roles).toEqual({ fast: "a/b" });
  });
  it("missing file → empty config", () => {
    expect(readRoleConfigFromDisk(home()).roles).toEqual({});
  });
  it("garbled file → empty config", () => {
    expect(readRoleConfigFromDisk(home("{not json")).roles).toEqual({});
  });
});
