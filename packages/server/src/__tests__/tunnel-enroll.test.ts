import { describe, expect, it, vi } from "vitest";
import { ENROLL_STEPS, type EnrollRunner, isEnrollStepWhitelisted, runEnrollStep } from "../tunnel/tunnel-enroll.js";

const okRunner: EnrollRunner = async () => ({ ok: true, value: true });

describe("enroll executor — security boundary (6.2/6.3)", () => {
  it("rejects an unknown (provider, step) WITHOUT spawning", async () => {
    const run = vi.fn(okRunner);
    const r = await runEnrollStep("zerotier", "auth-token" as any, "whatever", run);
    expect(r).toMatchObject({ ok: false, reason: "unknown-step" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an invalid parameter WITHOUT spawning", async () => {
    const run = vi.fn(okRunner);
    // ngrok token with a shell metacharacter must fail the strict allow-list.
    const r = await runEnrollStep("ngrok", "auth-token", "abc & calc.exe", run);
    expect(r).toMatchObject({ ok: false, reason: "invalid-param" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects cmd.exe metacharacters for every provider (no breakout)", async () => {
    const run = vi.fn(okRunner);
    const hostile = 'x" & calc | echo ^%PATH%^ > z';
    for (const [provider, steps] of Object.entries(ENROLL_STEPS)) {
      for (const step of steps) {
        const r = await runEnrollStep(provider as any, step, hostile, run);
        expect(r.ok).toBe(false);
      }
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a well-formed token and passes it as a single argv element", async () => {
    const seen: { binary: string; args: string[] } = { binary: "", args: [] };
    const run: EnrollRunner = async (binary, args) => { seen.binary = binary; seen.args = args; return { ok: true, value: true }; };
    const tok = "2abcDEF_012345678901234567890";
    const r = await runEnrollStep("ngrok", "auth-token", tok, run);
    expect(r.ok).toBe(true);
    expect(seen.binary).toBe("ngrok");
    expect(seen.args).toEqual(["config", "add-authtoken", tok]);
    // token is one element, not interpolated into a command string
    expect(seen.args.filter((a) => a === tok)).toHaveLength(1);
  });

  it("validates each provider's token shape", async () => {
    expect((await runEnrollStep("tailscale", "auth-token", "tskey-auth-abc123DEF", okRunner)).ok).toBe(true);
    expect((await runEnrollStep("tailscale", "auth-token", "not-a-tskey", okRunner)).ok).toBe(false);
    expect((await runEnrollStep("zerotier", "activate", "8056c2e21c000001", okRunner)).ok).toBe(true);
    expect((await runEnrollStep("zerotier", "activate", "ZZZZ", okRunner)).ok).toBe(false);
  });

  it("redacts the secret from error output (never leaks the token)", async () => {
    const tok = "2abcDEF_012345678901234567890";
    const run: EnrollRunner = async () => ({ ok: false, error: { kind: "exit", code: 1, signal: null, stdout: "", stderr: `bad token ${tok} rejected` } });
    const r = await runEnrollStep("ngrok", "auth-token", tok, run);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain(tok);
  });

  it("install is not a whitelisted server-side step (copy-paste only)", () => {
    expect(isEnrollStepWhitelisted("ngrok", "install")).toBe(false);
    expect(isEnrollStepWhitelisted("ngrok", "auth-token")).toBe(true);
  });
});
