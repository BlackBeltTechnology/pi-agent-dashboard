/**
 * Non-destructive import: names-only proposals, size cap, opaque candidate ids,
 * no client-supplied paths, source files untouched.
 * See change: add-credential-vault (test-plan E16, E17, E18).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultImport } from "../vault/vault-import.js";
import { registerVaultRoutes } from "../vault/vault-routes.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";

let dir: string;
let store: VaultStore;
let app: FastifyInstance;
let envFile: string;
let authFile: string;

async function mkApp() {
  const importer = createVaultImport({
    store,
    candidates: () => [
      { id: "cand-env", label: "skill .env", path: envFile, format: "env" },
      { id: "cand-auth", label: "system-one auth.json", path: authFile, format: "json" },
    ],
  });
  app = Fastify();
  registerVaultRoutes(app, { store, importer, networkGuard: async () => {}, loginAvailable: () => false, getSessionBindingState: () => undefined });
  await app.ready();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-imp-"));
  store = createVaultStore(path.join(dir, "vault.json"));
  envFile = path.join(dir, ".env");
  authFile = path.join(dir, "auth.json");
  fs.writeFileSync(envFile, "GEMINI_API_KEY=abcdefgh12\nSHORT_KEY=abc\n");
  await mkApp();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });

describe("import from upload (E16)", () => {
  it("proposes names only, skips short values with a notice, creates only confirmed accounts", async () => {
    const content = 'A_KEY=abcdefgh12\nB_KEY=abc\nexport C_KEY="q u o t e d1"\n';
    const res = await post("/api/vault/import/propose", { content });
    expect(res.statusCode).toBe(200);
    const body = res.json().data as { id: string; items: Array<Record<string, unknown>>; skipped: Array<{ name: string; reason: string }> };
    expect(body.items).toEqual([{ name: "A_KEY" }, { name: "C_KEY" }]);
    expect(body.skipped).toEqual([{ name: "B_KEY", reason: "value shorter than 8 characters" }]);
    expect(res.body).not.toContain("abcdefgh12");
    expect(res.body).not.toMatch(/length/i);

    const confirm = await post("/api/vault/import/confirm", { proposalId: body.id, names: ["A_KEY"] });
    expect(confirm.statusCode).toBe(200);
    const accounts = await store.listAccounts();
    expect(accounts.map((a) => a.label)).toEqual(["A_KEY"]);
    expect(store.getKeyValue(accounts[0].id)).toBe("abcdefgh12");
  });

  it("an uploaded JSON key file is parsed like the known-location one", async () => {
    const res = await post("/api/vault/import/propose", { content: JSON.stringify({ SYSTEM_ONE_KEY: "abcdefgh1234", SHORT: "ab" }) });
    expect(res.json().data.items).toEqual([{ name: "SYSTEM_ONE_KEY" }]);
  });

  it("refuses an oversized known-location file before reading it", async () => {
    fs.writeFileSync(envFile, `A_KEY=${"x".repeat(70_000)}\n`);
    const readFile = vi.spyOn(fs.promises, "readFile");
    const res = await post("/api/vault/import/propose", { candidateId: "cand-env" });
    expect(res.statusCode).toBe(400);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload", async () => {
    const res = await post("/api/vault/import/propose", { content: `A=${"x".repeat(65_537 - 2)}` });
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(store.filePath)).toBe(false);
  });

  it("a proposal id is single-use and confirm refuses names that were not proposed", async () => {
    const p = (await post("/api/vault/import/propose", { content: "A_KEY=abcdefgh12" })).json().data as { id: string };
    expect((await post("/api/vault/import/confirm", { proposalId: p.id, names: ["NOT_PROPOSED"] })).statusCode).toBe(400);
    expect((await post("/api/vault/import/confirm", { proposalId: p.id, names: ["A_KEY"] })).statusCode).toBe(200);
    expect((await post("/api/vault/import/confirm", { proposalId: p.id, names: ["A_KEY"] })).statusCode).toBe(404);
  });
});

describe("import never reads client-supplied paths (E17)", () => {
  it("rejects a source path and an unknown candidate id without reading", async () => {
    const readFile = vi.spyOn(fs.promises, "readFile");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const a = await post("/api/vault/import/propose", { source: "/etc/passwd" });
    const b = await post("/api/vault/import/propose", { candidateId: "no-such-id" });
    expect(a.statusCode).toBe(400);
    expect([400, 404]).toContain(b.statusCode);
    for (const spy of [readFile, readFileSync]) {
      expect(spy.mock.calls.some((c) => String(c[0]).includes("passwd"))).toBe(false);
    }
  });
});

describe("known locations (E18)", () => {
  it("lists candidates without reading, reads only the selected one, and leaves the source untouched", async () => {
    const readFile = vi.spyOn(fs.promises, "readFile");
    const list = await app.inject({ method: "GET", url: "/api/vault/import/candidates" });
    expect(list.json().data).toEqual([
      { id: "cand-env", label: "skill .env", exists: true },
      { id: "cand-auth", label: "system-one auth.json", exists: false },
    ]);
    expect(readFile).not.toHaveBeenCalled();

    const before = { bytes: fs.readFileSync(envFile), mtime: fs.statSync(envFile).mtimeMs };
    const prop = (await post("/api/vault/import/propose", { candidateId: "cand-env" })).json().data as { id: string; items: unknown[]; skipped: unknown[] };
    expect(prop.items).toEqual([{ name: "GEMINI_API_KEY" }]);
    expect(prop.skipped).toHaveLength(1);
    await post("/api/vault/import/confirm", { proposalId: prop.id, names: ["GEMINI_API_KEY"] });
    expect(fs.readFileSync(envFile).equals(before.bytes)).toBe(true);
    expect(fs.statSync(envFile).mtimeMs).toBe(before.mtime);
    expect((await store.listAccounts()).map((a) => a.label)).toEqual(["GEMINI_API_KEY"]);
  });

  it("parses a json auth file of string values", async () => {
    fs.writeFileSync(authFile, JSON.stringify({ SYSTEM_ONE_KEY: "abcdefgh1234", N: 5, SHORT: "ab" }));
    const prop = (await post("/api/vault/import/propose", { candidateId: "cand-auth" })).json().data as { items: unknown[] };
    expect(prop.items).toEqual([{ name: "SYSTEM_ONE_KEY" }]);
  });
});
