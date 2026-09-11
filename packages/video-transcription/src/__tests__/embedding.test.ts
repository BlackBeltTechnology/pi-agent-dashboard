import { describe, expect, it, vi } from "vitest";

// The binding cannot be resolved in this environment; embedding.ts must never
// import it at module load, only when loadEmbedder is called.
vi.mock("sherpa-onnx-node", () => {
  throw new Error("Cannot find module 'sherpa-onnx-node'");
});

describe("embedding runtime", () => {
  it("X1 imports without the native binding (failure is deferred)", async () => {
    const mod = await import("../embedding.js");
    expect(typeof mod.loadEmbedder).toBe("function");
  });

  it("X2 fails on first use with an actionable message", async () => {
    const { loadEmbedder, EMBEDDING_DEPENDENCY, EMBEDDING_INSTALL_COMMAND } = await import(
      "../embedding.js"
    );
    await expect(loadEmbedder("/models/x.onnx")).rejects.toThrow(
      new RegExp(`${EMBEDDING_DEPENDENCY}.*${EMBEDDING_INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "s"),
    );
  });
});
