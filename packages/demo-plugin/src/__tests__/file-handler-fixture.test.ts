/**
 * Demo `editor-pane-file-handler` fixture (task 6.1): the `demo-docx` edit claim
 * passes manifest validation, its validator registers only under
 * PI_DASHBOARD_FIXTURE_PLUGINS=1, and the validator module accepts non-empty
 * content and rejects content starting with `REJECT`.
 * See change: add-editor-pane-file-handlers.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateManifest } from "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator";
import { fixtureEntryAllowed } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import * as client from "../client.js";
import registerPlugin, { DEMO_FILE_HANDLER_CLAIM, DEMO_FILE_VALIDATOR_MODULE } from "../server/index.js";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const enc = (s: string) => new TextEncoder().encode(s);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function register() {
  const registerFileValidator = vi.fn();
  const fastify = { get: () => {}, post: () => {}, delete: () => {} };
  await registerPlugin({ fastify, registerFileValidator } as never);
  return registerFileValidator;
}

describe("demo file-handler fixture", () => {
  it("manifest declares the demo-docx edit claim and it validates", () => {
    const manifest = validateManifest(pkg["pi-dashboard-plugin"], "demo");
    const claim = manifest.claims.find((c) => c.slot === "editor-pane-file-handler");
    expect(claim).toMatchObject({
      component: "DemoFileHandler",
      id: DEMO_FILE_HANDLER_CLAIM,
      extensions: [".docx"],
      mode: "edit",
      label: "Demo editor",
      keepAlive: { max: 3 },
      validator: true,
      copySuffix: "demo",
    });
    expect(typeof claim?.firstOverwriteNotice).toBe("string");
    expect(manifest.fixture).toBe(true);
    expect(typeof client.DemoFileHandler).toBe("function");
  });

  it("is a fixture: server entry is withheld without the gate, allowed with it", () => {
    expect(fixtureEntryAllowed(pkg["pi-dashboard-plugin"], {})).toBe(false);
    expect(fixtureEntryAllowed(pkg["pi-dashboard-plugin"], { PI_DASHBOARD_FIXTURE_PLUGINS: "1" })).toBe(true);
  });

  it("registers no validator without the gate", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "");
    expect(await register()).not.toHaveBeenCalled();
  });

  it("registers the validator for demo-docx under the gate; module exists in the package", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");
    const reg = await register();
    expect(reg).toHaveBeenCalledWith({ claimId: DEMO_FILE_HANDLER_CLAIM, module: DEMO_FILE_VALIDATOR_MODULE });
    expect(DEMO_FILE_VALIDATOR_MODULE.startsWith("./")).toBe(true);
    expect(existsSync(resolve(pkgDir, DEMO_FILE_VALIDATOR_MODULE))).toBe(true);
  });

  it("validator accepts non-empty content and rejects empty / REJECT-prefixed content", async () => {
    // Loaded by file URL, as the core worker does — plain ESM, no TS loader.
    const mod = await import(pathToFileURL(resolve(pkgDir, DEMO_FILE_VALIDATOR_MODULE)).href);
    expect(mod.validate(enc("hello"), ".docx")).toEqual({ ok: true });
    expect(mod.validate(enc("xREJECT"), ".docx")).toEqual({ ok: true });
    expect(mod.validate(enc("REJECT me"), ".docx")).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(mod.validate(new Uint8Array(0), ".docx")).toMatchObject({ ok: false });
  });
});
