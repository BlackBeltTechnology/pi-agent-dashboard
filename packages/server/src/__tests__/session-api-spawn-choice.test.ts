/**
 * POST /api/session/spawn — model / thinking / @role / initialPrompt /
 * attachProposal, strict validation before any side effect.
 * test-plan: E10, E11, E12, E13, E14, X1. See change: add-spawn-model-choice.
 * Exemplar: session-api-spawn-owner.test.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingAttachRegistry } from "../pending/pending-attach-registry.js";
import { createPendingInitialPromptRegistry } from "../pending/pending-initial-prompt-registry.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { registerSessionApi } from "../session/session-api.js";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnPiSession: spawn,
}));
vi.mock("../spawn-process/spawn-register-watchdog.js", () => ({ armSpawnWatchdog: vi.fn() }));
vi.mock("../spawn-process/acp-spawn.js", () => ({
  validateAcpAgent: (id: unknown) => (id === "qmt" ? { ok: true, agent: { id: "qmt" } } : { ok: false, message: "unknown" }),
  preflightAcpSpawn: () => ({ ok: true, reasons: [] }),
  spawnAcpSession: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
}));

function writeRoles(roles: Record<string, string>): void {
  const dir = join(process.env.HOME as string, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "providers.json"), JSON.stringify({ roles }));
}

function build() {
  const norm = { normalize: (c: string) => c };
  const prompts = createPendingInitialPromptRegistry(norm);
  const attach = createPendingAttachRegistry(norm);
  const owner = { file: vi.fn(), remove: vi.fn(), resolve: vi.fn(), size: vi.fn() };
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    (req as { principal?: unknown }).principal = { iss: "i", sub: "s" };
  });
  registerSessionApi(app, {
    sessionManager: createMemorySessionManager(),
    piGateway: {} as never,
    browserGateway: { headlessPidRegistry: { register: vi.fn() } } as never,
    isResolverActive: () => true,
    pendingPrincipalOwnerRegistry: owner as never,
    pendingInitialPromptRegistry: prompts,
    pendingAttachRegistry: attach,
  });
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/session/spawn", payload: payload as object });
  return { post, prompts, attach, owner };
}

beforeEach(() => {
  spawn.mockReset();
  spawn.mockResolvedValue({ success: true, message: "ok" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  writeRoles({ fast: "anthropic/claude-haiku-5-5" });
});

describe("POST /api/session/spawn choice", () => {
  it("E10: @role resolves and reaches spawnPiSession", async () => {
    const { post } = build();
    const res = await post({ cwd: "/p", model: "@fast" });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(spawn).toHaveBeenCalledWith("/p", expect.objectContaining({ model: "anthropic/claude-haiku-5-5" }));
  });

  it("E11: invalid bodies → 400 before any side effect", async () => {
    const bodies = [
      { model: "@ghost" },
      { thinkingLevel: "turbo" },
      { model: 123 },
      { initialPrompt: {} },
      { agent: "qmt", model: "openai/gpt-6" },
      { agent: "qmt", thinkingLevel: "low" },
    ];
    for (const b of bodies) {
      const { post, prompts, attach, owner } = build();
      const res = await post({ cwd: "/p", initialPrompt: "x", attachProposal: "c", ...b });
      expect(res.statusCode, JSON.stringify(b)).toBe(400);
      expect(res.json().error, JSON.stringify(b)).toBeTruthy();
      expect(spawn).not.toHaveBeenCalled();
      expect(owner.file).not.toHaveBeenCalled();
      expect(prompts.size("/p")).toBe(0);
      expect(attach.size("/p")).toBe(0);
    }
  });

  it("E12: empty strings count as absent", async () => {
    const { post, prompts } = build();
    const res = await post({ cwd: "/p", model: "", initialPrompt: "" });
    expect(res.statusCode).toBe(200);
    expect(spawn.mock.calls[0][1]).not.toHaveProperty("model");
    expect(prompts.size("/p")).toBe(0);
  });

  it("E13: legacy body spawns with no model / thinking", async () => {
    const { post } = build();
    const res = await post({ cwd: "/p" });
    expect(res.statusCode).toBe(200);
    expect(spawn.mock.calls[0][1]).not.toHaveProperty("model");
    expect(spawn.mock.calls[0][1]).not.toHaveProperty("thinking");
  });

  it("E14: initialPrompt + attachProposal queued for session_register", async () => {
    const { post, prompts, attach } = build();
    const res = await post({ cwd: "/p", initialPrompt: "hello", attachProposal: "my-change" });
    expect(res.statusCode).toBe(200);
    expect(prompts.consume("/p")).toBe("hello");
    expect(attach.consume("/p")).toBe("my-change");
  });

  it("X1: failed spawn withdraws only its own intents", async () => {
    const { post, prompts } = build();
    prompts.enqueue("/p", "A");
    spawn.mockResolvedValue({ success: false, message: "boom" });
    const res = await post({ cwd: "/p", initialPrompt: "B" });
    expect(res.statusCode).toBe(500);
    expect(prompts.size("/p")).toBe(1);
    expect(prompts.consume("/p")).toBe("A");
  });
});
