import { describe, expect, it } from "vitest";
import {
  buildEmptyActionableLogLine,
  buildModelErrorLogLine,
  extractModelTurnError,
  redactSecrets,
} from "../spawn-process/spawned-turn-log.js";

describe("redactSecrets", () => {
  it("redacts a bearer token", () => {
    const out = redactSecrets("Authorization: Bearer ya29.aBcDeF0123456789xyzTOKEN");
    expect(out).not.toContain("ya29.aBcDeF0123456789xyzTOKEN");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a Google API key", () => {
    const key = "AIzaSyD-1234567890abcdefghijklmnopqrstuv";
    const out = redactSecrets(`request failed with key ${key}`);
    expect(out).not.toContain(key);
  });

  it("redacts a long opaque credential blob", () => {
    const blob = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789";
    const out = redactSecrets(`token=${blob}`);
    expect(out).not.toContain(blob);
  });

  it("leaves ordinary error prose intact", () => {
    const msg = "provider returned error: 503 service unavailable";
    expect(redactSecrets(msg)).toBe(msg);
  });
});

describe("log line builders never leak credentials (spec req: no leakage)", () => {
  it("empty-actionable line contains no token", () => {
    const line = buildEmptyActionableLogLine({
      sessionId: "s1",
      model: "google-vertex/gemini-2.5-pro",
      message: "model returned only reasoning, no answer (Bearer ya29.SECRETTOKEN0123456789abc)",
    });
    expect(line).not.toContain("ya29.SECRETTOKEN0123456789abc");
    expect(line).toContain("session=s1");
    expect(line).toContain("empty-actionable");
  });

  it("model-error line contains no api key", () => {
    const key = "AIzaSyD-1234567890abcdefghijklmnopqrstuv";
    const line = buildModelErrorLogLine({
      sessionId: "s2",
      model: "google-vertex/gemini-2.5-pro",
      stopReason: "error",
      message: `403 permission denied for key ${key}`,
    });
    expect(line).not.toContain(key);
    expect(line).toContain("session=s2");
    expect(line).toContain("stopReason=error");
  });
});

describe("extractModelTurnError", () => {
  it("returns the error for a terminal error turn", () => {
    const got = extractModelTurnError({
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "503 unavailable", provider: "google-vertex", model: "gemini-2.5-pro" },
      ],
    });
    expect(got).toEqual({ message: "503 unavailable", model: "google-vertex/gemini-2.5-pro", stopReason: "error" });
  });

  it("returns null for a clean stop (empty-actionable is NOT an error)", () => {
    expect(
      extractModelTurnError({ messages: [{ role: "assistant", stopReason: "stop", content: [] }] }),
    ).toBeNull();
  });

  it("returns null when there are no messages", () => {
    expect(extractModelTurnError({})).toBeNull();
    expect(extractModelTurnError({ messages: [] })).toBeNull();
  });

  it("falls back to a generic message when errorMessage is absent", () => {
    const got = extractModelTurnError({
      messages: [{ role: "assistant", stopReason: "error", model: "gemini-2.5-pro" }],
    });
    expect(got?.message).toBe("model turn ended with an error");
    expect(got?.model).toBe("gemini-2.5-pro");
  });
});
