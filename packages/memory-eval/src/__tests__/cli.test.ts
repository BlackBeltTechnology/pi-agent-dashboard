import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { makeEnv } from "./helpers/ctx.js";

describe("cli", () => {
  it("--help lists every subcommand", async () => {
    const env = makeEnv();
    expect(await main(["--help"], env.ctx)).toBe(0);
    const out = env.stdout.join("");
    for (const s of ["cases build", "run", "judge", "report", "status"]) expect(out).toContain(`memory-eval ${s}`);
  });

  it("unknown commands fail with a message", async () => {
    const env = makeEnv();
    expect(await main(["bogus"], env.ctx)).not.toBe(0);
    expect(env.stderr.join("")).toContain("unknown command 'bogus'");
  });

  it("the bin shim runs the CLI through tsx", () => {
    const r = spawnSync(process.execPath, [resolve(__dirname, "../../bin/memory-eval.mjs"), "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("memory-eval cases build");
  });
});
