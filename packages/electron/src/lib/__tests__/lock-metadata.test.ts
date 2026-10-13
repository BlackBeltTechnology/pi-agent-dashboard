/**
 * The Electron lock-metadata reader looks where the server writes it.
 * See change: harden-dashboard-start-detection (D6; test-plan E22).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMetaPath } from "../../../../server/src/lifecycle/home-lock.js";
import { getLockMetaPath, readDashboardLockMetadata } from "../lock-metadata.js";

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "elec-lockmeta-"));
  savedHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("getLockMetaPath", () => {
  it("E22: equals the server's metadata path under a HOME override, both under <HOME>/.pi/dashboard/", () => {
    const electronPath = getLockMetaPath();
    expect(electronPath).toBe(getMetaPath());
    expect(electronPath.startsWith(path.join(home, ".pi", "dashboard") + path.sep)).toBe(true);
    expect(path.basename(electronPath)).toBe("server.lock.meta.json");
  });

  it("reads a record the server wrote under the overridden HOME", () => {
    const dir = path.join(home, ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "server.lock.meta.json"),
      JSON.stringify({ pid: 42, httpPort: 8123, piPort: 9999, startedAt: 1, identity: "i", version: "v", url: "http://localhost:8123", hostname: "h" }),
    );
    expect(readDashboardLockMetadata()).toMatchObject({ pid: 42, httpPort: 8123 });
  });
});
