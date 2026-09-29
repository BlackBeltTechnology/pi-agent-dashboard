/**
 * VAPID keypair lifecycle: generated once at 0600, reused across restarts,
 * served by `GET /api/push/vapid-public-key` when push is enabled.
 * Harness: json-store.test.ts (tmp dir) + test-server for the endpoint.
 * See change: add-server-push-notifications (test-plan #E37).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrGenerateVapidKeys } from "../push/push-vapid.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

describe("loadOrGenerateVapidKeys (test-plan #E37)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-vapid-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the file with {publicKey, privateKey} and reuses it on the next start", () => {
    const file = path.join(tmpDir, "push-vapid.json");
    const first = loadOrGenerateVapidKeys(file);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(onDisk).toEqual({ publicKey: first.publicKey, privateKey: first.privateKey });
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    const second = loadOrGenerateVapidKeys(file);
    expect(second).toEqual(first);
  });
});

describe("GET /api/push/vapid-public-key with push enabled (test-plan #E37)", () => {
  let handle: TestServerHandle | undefined;

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("returns the persisted public key, identical after a restart", async () => {
    const push = { enabled: true, coalesceWindowMs: 30_000, webPush: { contactEmail: "me@example.com" } };
    handle = await createTestServer({ push });
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/push/vapid-public-key`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicKey: string };
    const onDisk = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "push-vapid.json"), "utf-8"));
    expect(body).toEqual({ publicKey: onDisk.publicKey });
    await handle.stop();

    handle = await createTestServer({ push });
    const again = (await (await fetch(`http://127.0.0.1:${handle.httpPort}/api/push/vapid-public-key`)).json()) as {
      publicKey: string;
    };
    expect(again.publicKey).toBe(body.publicKey);
  });
});
