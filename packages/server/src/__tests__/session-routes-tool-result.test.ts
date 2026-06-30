/**
 * Strategy B full-fidelity route: GET /api/sessions/:sessionId/tool-result/:entryId
 * returns the UNTRUNCATED tool body from JSONL; 404 on unknown session/entry.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerSessionRoutes } from "../routes/session-routes.js";

function noGuard() {
  return async () => {};
}

function writeSessionFile(bodyText: string): string {
  const file = path.join(os.tmpdir(), `ffr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const lines = [
    JSON.stringify({ type: "session", id: "sess-1" }),
    JSON.stringify({ type: "message", id: "u1", parentId: "sess-1", message: { role: "user", content: "run it" } }),
    JSON.stringify({
      type: "message",
      id: "tr1",
      parentId: "u1",
      message: { role: "toolResult", toolCallId: "tc1", toolName: "Bash", isError: false, content: [{ type: "text", text: bodyText }] },
    }),
  ];
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

describe("GET /api/sessions/:sessionId/tool-result/:entryId", () => {
  let app: FastifyInstance;
  let file: string;
  const bigBody = "FULL-".repeat(2000); // ~10 KB, well past the 4 KB store cap

  beforeEach(async () => {
    file = writeSessionFile(bigBody);
    app = Fastify();
    const sessionManager = {
      get: (id: string) => (id === "sess-1" ? { sessionFile: file, cwd: "/tmp" } : undefined),
    } as any;
    registerSessionRoutes(app, { sessionManager, eventStore: {} as any, networkGuard: noGuard() as any });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(file, { force: true });
  });

  it("returns the untruncated tool body by entryId", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/sess-1/tool-result/tr1" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data.result).toBe(bigBody);
    expect(json.data.result.length).toBeGreaterThan(4000);
    expect(json.data.isError).toBe(false);
  });

  it("resolves by toolCallId when the key is not a JSONL entry id (live-path stub)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/sess-1/tool-result/tc1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.result).toBe(bigBody);
  });

  it("404s on an unknown entryId", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/sess-1/tool-result/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });

  it("404s on an unknown session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/ghost/tool-result/tr1" });
    expect(res.statusCode).toBe(404);
  });
});
