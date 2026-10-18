import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAuthSnapshotLocked, writeCredentialIfAbsent } from "../auth/provider-auth-storage.js";

/**
 * `writeCredentialIfAbsent`: the absence check and the write share one lock, so
 * an existing credential is refused and left unchanged. See change:
 * pi-settings-full-coverage (task 3.2).
 */
describe("writeCredentialIfAbsent", () => {
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");
  const read = () => JSON.parse(readFileSync(authPath, "utf-8"));

  beforeEach(() => {
    mkdirSync(authDir, { recursive: true });
    rmSync(authPath, { force: true });
  });
  afterEach(() => rmSync(authPath, { force: true }));

  it("writes when the provider holds nothing (creating auth.json at 0600)", async () => {
    expect(await writeCredentialIfAbsent("openai", { type: "api_key", key: "k1" })).toBe("written");
    expect(read()).toEqual({ openai: { type: "api_key", key: "k1" } });
  });

  it("refuses an existing credential of any type and leaves the file byte-identical", async () => {
    const seed = JSON.stringify({ openai: { type: "api_key", key: "orig" }, anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } });
    writeFileSync(authPath, seed, { mode: 0o600 });
    expect(await writeCredentialIfAbsent("openai", { type: "api_key", key: "new" })).toBe("exists");
    expect(await writeCredentialIfAbsent("anthropic", { type: "api_key", key: "new" })).toBe("exists");
    expect(readFileSync(authPath, "utf-8")).toBe(seed);
  });

  it("readAuthSnapshotLocked reports a corrupt file and never creates an absent one", async () => {
    expect(await readAuthSnapshotLocked()).toEqual({ data: {}, corrupt: false });
    expect(() => readFileSync(authPath, "utf-8")).toThrow();
    writeFileSync(authPath, "{ not json", { mode: 0o600 });
    expect((await readAuthSnapshotLocked()).corrupt).toBe(true);
  });
});
