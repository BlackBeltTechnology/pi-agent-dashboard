/**
 * E18 (worker leg) — the validator module registered through the REAL registry and executed in the REAL
 * validator worker pool: it loads there (node built-ins only), accepts a docx, rejects the rest.
 * See change: edit-office-in-pane-with-craft-web (D5, task 4.4), extend-craft-web-to-all-apps (D7 dispatcher).
 */
import path from "node:path";
import {
  createFileValidatorPool,
  type FileValidatorPool,
  FileValidatorRegistry,
  registerFileValidatorFor,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALIDATOR_MODULE } from "../index.js";

const packageDir = path.resolve(__dirname, "..", "..", "..");
const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const docx = (): Buffer =>
  Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(`<Types><Override PartName="/word/document.xml" ContentType="${DOCX_CT}"/></Types>`),
      "word/document.xml": strToU8("<doc/>"),
    }),
  );

describe("ooxml validator in the worker pool", () => {
  const registry = new FileValidatorRegistry();
  let pool: FileValidatorPool;
  let moduleUrl: string;

  beforeAll(() => {
    registerFileValidatorFor("craft-web", { packageDir, editClaimIds: ["wordcraft"] }, { claimId: "wordcraft", module: VALIDATOR_MODULE }, registry);
    moduleUrl = (registry.get("craft-web", "wordcraft") as { moduleUrl: string }).moduleUrl;
    pool = createFileValidatorPool({ size: 1 });
  });
  afterAll(() => pool.dispose());

  it("accepts a valid .docx", async () => {
    const bytes = docx();
    const out = await pool.run({ moduleUrl, bytes, ext: ".docx" });
    expect(out.kind).toBe("ok");
  });

  it("E20 worker leg: every dispatcher route loads and runs in the pool (valid → ok, unknown ext → rejected)", async () => {
    const samples: Array<[string, Uint8Array]> = [
      [".pdf", new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"))],
      [".rtf", new Uint8Array(Buffer.from("{\\rtf1 x}", "latin1"))],
      [".dxf", new Uint8Array(Buffer.from("  0\nSECTION\n  0\nENDSEC\n  0\nEOF\n", "latin1"))],
      [".scraftz", zipSync({ "Mix.scraft": strToU8("{}") })],
    ];
    for (const [ext, bytes] of samples) expect(await pool.run({ moduleUrl, bytes: Buffer.from(bytes), ext }), ext).toMatchObject({ kind: "ok" });
    expect(await pool.run({ moduleUrl, bytes: docx(), ext: ".exe" })).toMatchObject({ kind: "rejected" });
  });

  it("rejects garbage and a wrong kind with a reason", async () => {
    expect(await pool.run({ moduleUrl, bytes: Buffer.from("not a zip"), ext: ".docx" })).toMatchObject({ kind: "rejected" });
    expect(await pool.run({ moduleUrl, bytes: docx(), ext: ".xlsx" })).toMatchObject({ kind: "rejected" });
  });
});
