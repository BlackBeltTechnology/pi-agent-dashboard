/**
 * `hasAnthropicCredential()` — the one-time compat-switch seed's credential
 * check over pi's auth.json. Runs under a fresh tmp $HOME per test file
 * (setup-home-perfile.ts), so it writes `auth.json` directly.
 *
 * See change: seed-claude-compat-on-upgrade (test-plan #S3, design D2).
 */
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAnthropicCredential } from "../auth/provider-auth-storage.js";

const authDir = path.join(homedir(), ".pi", "agent");
const authPath = path.join(authDir, "auth.json");
const SECRET = "sk-ant-secret-value-never-logged";

function writeAuth(content: string | null): void {
  fs.rmSync(authPath, { force: true });
  if (content === null) return;
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(authPath, content);
}

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(authPath, { force: true });
});

describe("hasAnthropicCredential (S3)", () => {
  it.each([
    ["missing file", null, false],
    ["empty object", "{}", false],
    ["anthropic oauth", JSON.stringify({ anthropic: { type: "oauth", refresh: SECRET, access: SECRET, expires: 1 } }), true],
    ["anthropic api key", JSON.stringify({ anthropic: { type: "api_key", key: SECRET } }), true],
    ["other provider only", JSON.stringify({ openai: { type: "api_key", key: SECRET } }), false],
    ["unparseable", "{ not json", undefined],
  ] as const)("%s → %s", (_name, content, expected) => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    }
    writeAuth(content);
    expect(hasAnthropicCredential()).toBe(expected);
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});
