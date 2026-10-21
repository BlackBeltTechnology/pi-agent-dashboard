/**
 * Pins instance key order for classes that used constructor parameter
 * properties, so the erasable-only rewrite (explicit fields declared first, in
 * parameter order) stays output-identical under Node's native class-field
 * semantics. See change: strip-only-native-ts-loader (design D1, test-plan #E13).
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { YoloController } from "../access/yolo-session.js";
import { UserDirectory } from "../auth/passkey/user-directory.js";
import { PolicyTrustError } from "../identity/policy-registry.js";

describe("parameter-property rewrite preserves instance key order", () => {
  it("YoloController: deps first, then initialized fields, then the live-trust listener/timer slots (mirror-dashboard-trust-live-remote)", () => {
    const c = new YoloController({ hostGateMode: () => "enforce" as never, isRefused: () => false });
    expect(Object.keys(c)).toEqual(["deps", "session", "log", "totals", "now", "ladder", "emit", "changeListener", "expiryTimer"]);
  });

  it("GrantCoordinator: deps first", () => {
    const c = new GrantCoordinator({
      planes: {} as never,
      broadcast: () => {},
      hostGateMode: () => "enforce" as never,
      promptEnabled: () => true,
      killSwitch: () => false,
      operatorChannels: () => 0,
    });
    expect(Object.keys(c)).toEqual(["deps", "registry", "waiters", "timers", "origins", "verdicts", "now", "schedule"]);
  });

  it("UserDirectory: filePath, now, then state/chain in declaration order", () => {
    const d = new UserDirectory(path.join(os.tmpdir(), `pp-key-order-${process.pid}.json`), () => 0);
    expect(Object.keys(d)).toEqual(["filePath", "now", "state", "chain"]);
  });

  it("Error subclass keeps its keys and JSON shape", () => {
    const e = new PolicyTrustError("p");
    expect(Object.keys(e)).toEqual(["pluginId", "name"]);
    expect(JSON.stringify(e)).toBe('{"pluginId":"p","name":"PolicyTrustError"}');
  });
});
