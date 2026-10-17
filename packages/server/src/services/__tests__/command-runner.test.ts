/**
 * `defaultCommandRunner`: multi-byte output split across chunks decodes intact (log redaction
 * matches exact values), and the output cap sets `truncated`.
 * See change: add-services-settings-ui (review feedback).
 */
import { describe, expect, it } from "vitest";
import { defaultCommandRunner } from "../command-runner.js";

describe("defaultCommandRunner decoding", () => {
  it("a multi-byte character split across two writes is decoded once, not as U+FFFD", async () => {
    const script = `process.stdout.write(Buffer.from([0xe2, 0x82])); setTimeout(() => { process.stdout.write(Buffer.from([0xac])); process.stderr.write(Buffer.from([0xc3])); setTimeout(() => process.stderr.write(Buffer.from([0xa9])), 30); }, 60);`;
    const r = await defaultCommandRunner(process.execPath, ["-e", script], { timeoutMs: 10_000 });
    expect(r.stdout).toBe("€");
    expect(r.stderr).toBe("é");
    expect(r.truncated).toBeUndefined();
  });

  it("reports truncated when the cap dropped output", async () => {
    const script = `const chunk = "x".repeat(1024 * 1024); let n = 0; const t = setInterval(() => { process.stdout.write(chunk); if (++n >= 6) clearInterval(t); }, 5);`;
    const r = await defaultCommandRunner(process.execPath, ["-e", script], { timeoutMs: 20_000 });
    expect(r.truncated).toBe(true);
  });
});
