/**
 * The bridge side of D6 (task 5.3): present `X-Pi-Local-Token` when dialling a
 * LOOPBACK TCP gateway — the only local credential Windows has, since it gets
 * no unix socket.
 *
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { localTokenHeaders, readLocalToken } from "../local-token-header.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-token-"));
});

function writeToken(value: string) {
  const dir = path.join(home, ".pi", "dashboard", "local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "token"), `${value}\n`);
}

describe("readLocalToken", () => {
  it("reads the token this HOME's dashboard wrote, trimmed", () => {
    writeToken("s3cret-token");
    expect(readLocalToken({ homedir: home })).toBe("s3cret-token");
  });

  it("returns undefined when no dashboard has ever written one", () => {
    expect(readLocalToken({ homedir: home })).toBeUndefined();
  });

  it("treats an empty token file as no token, never as an empty credential", () => {
    writeToken("   ");
    expect(readLocalToken({ homedir: home })).toBeUndefined();
  });
});

describe("localTokenHeaders", () => {
  beforeEach(() => writeToken("s3cret-token"));

  it("presents the token on a loopback TCP endpoint", () => {
    expect(localTokenHeaders("ws://127.0.0.1:9999", { homedir: home })).toEqual({
      "X-Pi-Local-Token": "s3cret-token",
    });
    expect(localTokenHeaders("ws://localhost:9999", { homedir: home })).toHaveProperty(
      "X-Pi-Local-Token",
    );
  });

  it("sends NOTHING over a unix socket — the file mode already decided (D5)", () => {
    expect(localTokenHeaders("ws+unix:///tmp/gateway-9999.sock", { homedir: home })).toBeUndefined();
  });

  it("never leaks the token to a REMOTE endpoint", () => {
    expect(localTokenHeaders("ws://dash.example:9999", { homedir: home })).toBeUndefined();
    expect(localTokenHeaders("wss://dash.example", { homedir: home })).toBeUndefined();
  });

  it("is undefined when there is no token to present", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-token-"));
    expect(localTokenHeaders("ws://127.0.0.1:9999", { homedir: empty })).toBeUndefined();
  });
});
