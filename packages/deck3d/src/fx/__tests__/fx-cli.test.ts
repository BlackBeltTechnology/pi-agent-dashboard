import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function fx(args: string[]) {
  return spawnSync(BIN, ["fx", ...args], { encoding: "utf8" });
}

describe("deck3d fx (E45-adjacent)", () => {
  it("lists the catalogue", () => {
    const r = fx(["list"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("tokens");
    expect(r.stdout).toContain("starfield");
  });

  it("filters by kind and content tag", () => {
    const r = fx(["list", "--kind", "background", "--tag", "network"]);
    expect(r.status, r.stderr).toBe(0);
    const ids = r.stdout
      .trim()
      .split("\n")
      .map((l) => l.split("\t")[0]);
    expect(ids).toContain("grid-horizon");
    expect(ids).toContain("swarm");
    expect(ids.every((id) => id !== "bloom")).toBe(true);
  });

  it("emits parseable JSON", () => {
    const r = fx(["list", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const rows = JSON.parse(r.stdout);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.find((x: { id: string }) => x.id === "bloom").kind).toBe("post");
  });
});
