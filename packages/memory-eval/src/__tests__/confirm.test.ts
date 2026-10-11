import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { terminalConfirm } from "../confirm.js";
import { defaultCtx } from "../ctx.js";

function ask(answer: string | null): Promise<boolean> {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = terminalConfirm("send? ", input, output);
  if (answer !== null) input.write(answer);
  input.end();
  return pending;
}

describe("terminal confirmation", () => {
  it("B1: y / yes confirm; anything else, an empty line and EOF decline", async () => {
    expect(await ask("y\n")).toBe(true);
    expect(await ask("YES\n")).toBe(true);
    expect(await ask("n\n")).toBe(false);
    expect(await ask("\n")).toBe(false);
    expect(await ask("maybe\n")).toBe(false);
    expect(await ask(null)).toBe(false); // EOF before an answer must not hang
  });

  it("B1: the shipped context carries a real confirm, so a TTY run is not refused outright", () => {
    expect(typeof defaultCtx().confirm).toBe("function");
  });
});
