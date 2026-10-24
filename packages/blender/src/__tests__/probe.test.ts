/**
 * JSPI probe classification (design D2, task 3.1) with injected spawn results: `native` (no flag needed),
 * `flag` (needs --experimental-wasm-jspi), `unavailable`; the flag run happens only when needed.
 *
 * See change: add-blender-wasm-mcp (task 3.1).
 */
import { describe, expect, it, vi } from "vitest";
import { hostArgv, JSPI_FLAG, resolveHostEntry } from "../host/entry.js";
import { type ProbeSpawn, probeJspi, type SpawnResult } from "../host/probe.js";

const yes: SpawnResult = { code: 0, stdout: '{"jspi":true}\n', stderr: "" };
const no: SpawnResult = { code: 0, stdout: '{"jspi":false}\n', stderr: "" };
const badOption: SpawnResult = { code: 9, stdout: "", stderr: "node: bad option: --experimental-wasm-jspi\n" };

/** A spawn replacement answering from `results` in call order; records the flags it was called with. */
function spawnOf(...results: SpawnResult[]): { spawn: ProbeSpawn; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const spawn: ProbeSpawn = vi.fn(async (flags: readonly string[]) => {
    calls.push(flags);
    const r = results[calls.length - 1];
    if (!r) throw new Error("unexpected extra probe spawn");
    return r;
  });
  return { spawn, calls };
}

describe("probeJspi", () => {
  it("no-flag run reporting jspi:true → native, with a single spawn (no flag run)", async () => {
    const { spawn, calls } = spawnOf(yes);
    expect(await probeJspi(spawn, "v24.15.0")).toEqual({ mode: "native", node: "v24.15.0" });
    expect(calls).toEqual([[]]);
  });

  it("no-flag run exit 9 ('bad option'), flag run jspi:true → flag", async () => {
    const { spawn, calls } = spawnOf(badOption, yes);
    expect(await probeJspi(spawn, "v24.15.0")).toEqual({ mode: "flag", node: "v24.15.0" });
    expect(calls).toEqual([[], [JSPI_FLAG]]);
  });

  it("no-flag run jspi:false, flag run jspi:true → flag", async () => {
    const { spawn, calls } = spawnOf(no, yes);
    expect((await probeJspi(spawn)).mode).toBe("flag");
    expect(calls).toEqual([[], [JSPI_FLAG]]);
  });

  it("both runs fail → unavailable, carrying the node version", async () => {
    const { spawn, calls } = spawnOf(badOption, badOption);
    expect(await probeJspi(spawn, "v22.22.0")).toEqual({ mode: "unavailable", node: "v22.22.0" });
    expect(calls).toEqual([[], [JSPI_FLAG]]);
  });

  it("jspi:false twice, or a non-zero exit even when stdout says jspi:true, is unavailable", async () => {
    expect((await probeJspi(spawnOf(no, no).spawn)).mode).toBe("unavailable");
    const crashed: SpawnResult = { code: 1, stdout: '{"jspi":true}\n', stderr: "" };
    expect((await probeJspi(spawnOf(crashed, crashed).spawn)).mode).toBe("unavailable");
    const killed: SpawnResult = { code: null, stdout: "", stderr: "" };
    expect((await probeJspi(spawnOf(killed, killed).spawn)).mode).toBe("unavailable");
  });

  it("finds the JSON line among other output and ignores non-JSON noise", async () => {
    const noisy: SpawnResult = { code: 0, stdout: 'ExperimentalWarning: something\n{"unrelated":1}\n{"jspi":true}\n\n', stderr: "" };
    expect((await probeJspi(spawnOf(noisy).spawn)).mode).toBe("native");
    const garbage: SpawnResult = { code: 0, stdout: "jspi: true\n[true]\n", stderr: "" };
    expect((await probeJspi(spawnOf(garbage, garbage).spawn)).mode).toBe("unavailable");
  });

  it("the node version defaults to process.version", async () => {
    expect((await probeJspi(spawnOf(yes).spawn)).node).toBe(process.version);
  });
});

describe("host entry argv", () => {
  it("puts V8 flags first, then the entry, then the host arguments", () => {
    const argv = hostArgv([JSPI_FLAG], ["--probe"]);
    expect(argv[0]).toBe(JSPI_FLAG);
    expect(argv.at(-1)).toBe("--probe");
    expect(argv.slice(1, -1)).toEqual(resolveHostEntry().args);
    expect(hostArgv([], ["--probe"])).toEqual([...resolveHostEntry().args, "--probe"]);
  });
});
