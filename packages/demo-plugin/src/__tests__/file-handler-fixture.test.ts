/**
 * The demo fixture's `editor-pane-file-handler` claim (`.docx`, edit,
 * keepAlive, validator, copySuffix `demo`) validates, is fixture-gated, and its
 * server entry registers a working validator. See change: add-editor-pane-file-handlers (6.1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator";
import {
  createFileValidatorPool,
  createServerPluginContext,
  fixtureEntryAllowed,
  getFileValidatorRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it } from "vitest";
import registerPlugin from "../server/index.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
const manifest = validateManifest(pkg["pi-dashboard-plugin"]);
const claim = manifest.claims.find((c) => c.slot === "editor-pane-file-handler");

afterEach(() => getFileValidatorRegistry().unregisterPlugin("demo"));

describe("demo file-handler fixture claim", () => {
  it("declares the .docx edit claim from task 6.1", () => {
    expect(claim).toMatchObject({
      id: "docx",
      extensions: [".docx"],
      mode: "edit",
      keepAlive: { max: 2 },
      validator: true,
      copySuffix: "demo",
    });
    expect(claim?.component).toBe("DemoDocxHandler");
  });

  it("is a fixture plugin: loads only under PI_DASHBOARD_FIXTURE_PLUGINS=1", () => {
    expect(manifest.fixture).toBe(true);
    expect(fixtureEntryAllowed(manifest, {})).toBe(false);
    expect(fixtureEntryAllowed(manifest, { PI_DASHBOARD_FIXTURE_PLUGINS: "1" })).toBe(true);
  });

  it("the client entry exports the claim's component", () => {
    const src = fs.readFileSync(path.join(pkgDir, "src", "client.tsx"), "utf-8");
    expect(src).toMatch(/export (async )?function DemoDocxHandler/);
  });

  it("the server entry registers a validator that accepts normal bytes and rejects the marker", async () => {
    const ctx = createServerPluginContext(
      { fastify: { get() {}, post() {}, delete() {} } } as never,
      "demo",
      [],
      { packageDir: pkgDir, editClaimIds: ["docx"] },
    );
    await registerPlugin(ctx);
    const reg = getFileValidatorRegistry().get("demo", "docx");
    expect(reg).toBeDefined();
    const pool = createFileValidatorPool({ size: 1 });
    try {
      const ok = await pool.run({ moduleUrl: reg!.moduleUrl, bytes: Buffer.from("PK-fake-docx"), ext: ".docx" });
      expect(ok.kind).toBe("ok");
      const bad = await pool.run({ moduleUrl: reg!.moduleUrl, bytes: Buffer.from("xx REJECT-ME xx"), ext: ".docx" });
      expect(bad).toMatchObject({ kind: "rejected" });
    } finally {
      await pool.dispose();
    }
  });
});
