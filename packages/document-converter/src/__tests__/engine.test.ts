import { describe, expect, it, vi } from "vitest";
import { runEngine, type EngineRunner } from "../engine.js";
import { DocConverterError } from "../errors.js";

const okRunner =
  (payload: object): EngineRunner =>
  async () => ({ stdout: JSON.stringify({ ok: true, ...payload }), stderr: "", exitCode: 0 });

describe("runEngine envelope handling", () => {
  it("returns the ok envelope minus the ok flag", async () => {
    const res = await runEngine(
      { image: "pi-doc-engine:test", runner: okRunner({ output: "/out.docx" }) },
      { command: "renderDocx", input: "/in.md", output: "/out.docx" },
    );
    expect(res).toEqual({ output: "/out.docx" });
  });

  it("maps an error envelope to a typed DocConverterError", async () => {
    const runner: EngineRunner = async () => ({
      stdout: JSON.stringify({
        ok: false,
        error: { code: "INGEST_FAILED", message: "boom", stderr: "trace" },
      }),
      stderr: "",
      exitCode: 1,
    });
    await expect(
      runEngine({ image: "x", runner }, { command: "convertToMarkdown", input: "/a.pdf" }),
    ).rejects.toMatchObject({ code: "INGEST_FAILED", message: "boom", stderr: "trace" });
  });

  it("rejects non-JSON stdout with BAD_RESPONSE on clean exit", async () => {
    const runner: EngineRunner = async () => ({ stdout: "not json", stderr: "", exitCode: 0 });
    await expect(
      runEngine({ image: "x", runner }, { command: "renderPdf", input: "/a.md", output: "/a.pdf" }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("rejects non-JSON stdout with ENGINE_NONZERO on bad exit", async () => {
    const runner: EngineRunner = async () => ({ stdout: "", stderr: "docker: not found", exitCode: 127 });
    await expect(
      runEngine({ image: "x", runner }, { command: "renderPdf", input: "/a.md", output: "/a.pdf" }),
    ).rejects.toMatchObject({ code: "ENGINE_NONZERO", exitCode: 127 });
  });

  it("builds path-identical bind mounts for every referenced path", async () => {
    const runner = vi.fn<EngineRunner>(async () => ({
      stdout: JSON.stringify({ ok: true }),
      stderr: "",
      exitCode: 0,
    }));
    await runEngine(
      { image: "pi-doc-engine:test", runner, mounts: [] },
      { command: "renderDocx", input: "/work/in.md", output: "/work/out.docx" },
    );
    const argv = runner.mock.calls[0][0];
    expect(argv).toContain("-v");
    expect(argv).toContain("/work:/work");
    expect(argv).toContain("pi-doc-engine:test");
    // mount appears once even though two paths share /work
    expect(argv.filter((a) => a === "/work:/work")).toHaveLength(1);
  });

  it("surfaces DOCKER_UNAVAILABLE when the runner cannot spawn", async () => {
    const runner: EngineRunner = async () => {
      throw new DocConverterError({ code: "DOCKER_UNAVAILABLE", message: "no docker" });
    };
    await expect(
      runEngine({ image: "x", runner }, { command: "renderPdf", input: "/a.md", output: "/a.pdf" }),
    ).rejects.toMatchObject({ code: "DOCKER_UNAVAILABLE" });
  });
});
