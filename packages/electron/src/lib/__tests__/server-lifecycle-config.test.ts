/**
 * `loadMinimalConfig` reads the bind host the server actually persists
 * (`bindHost`), so main-process calls dial the literal the server listens on.
 *
 * See change: loopback-credential-proof (D10).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMinimalConfig } from "../server-lifecycle.js";

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "elec-config-"));
  savedHome = process.env.HOME;
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

const write = (cfg: unknown) => fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(cfg));

describe("loadMinimalConfig bind host", () => {
  it("reads the persisted `bindHost`", () => {
    write({ port: 8123, bindHost: "::1" });
    expect(loadMinimalConfig()).toMatchObject({ port: 8123, host: "::1" });
  });

  it("ignores a legacy-looking `host` key and leaves host unset when there is no bindHost", () => {
    write({ port: 8123, host: "10.0.0.9" });
    expect(loadMinimalConfig().host).toBeUndefined();
  });
});
