/**
 * Bridge-side delivery of the minted MCP session token
 * (wire-mcp-session-token, test-plan F2/F3/F4).
 *
 * The module under test is the ENTIRE in-session surface of credential
 * delivery: `handleMcpTokenMinted` assigns the plaintext to process.env
 * (D2 step 2) and triggers the D6 recovery seam — and does NOTHING else.
 * Every test here guards one of the three invariants the design stakes on
 * that narrowness:
 *
 * - F2: the env write strictly PRECEDES the recovery trigger (reconnecting
 *   before the fresh value is in the env presents the stale credential —
 *   spike Q3 step 4 measured the misleading failure that causes).
 * - F3: no recovery decision consults `connection.status` (measured to read
 *   `connected` while every request 401s — spike Q3). The module's deps have
 *   no status input at all; the mint reply is the sole trigger.
 * - F4: the plaintext never reaches `pi.events` (measured broadcast leak,
 *   spike Q4b) — the module takes no event bus, so there is nothing to leak
 *   through; the tests pin that with a poisoned emit spy.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MCP_TOKEN_ENV_VAR,
  handleMcpTokenMinted,
  type McpTokenDeliveryDeps,
} from "../mcp-token-delivery.js";

function makeDeps() {
  const calls: string[] = [];
  const deps: McpTokenDeliveryDeps & { events: { emit: ReturnType<typeof vi.fn> } } = {
    assignEnv: (token) => {
      calls.push(`env:${token}`);
    },
    reconnect: () => {
      calls.push("reconnect");
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    // Poisoned bus: if the module EVER found a way to emit, these catch it.
    events: { emit: vi.fn() },
  };
  return { deps, calls };
}

const minted = (token: string) => ({ type: "mcp_token_minted" as const, token });

describe("F2 — the env write precedes the reconnect trigger", () => {
  it("assigns the env var, and only then calls reconnect, exactly once", () => {
    const { deps, calls } = makeDeps();
    handleMcpTokenMinted(minted("mcp_token-1"), deps);
    expect(calls).toEqual(["env:mcp_token-1", "reconnect"]);
  });

  it("a rejected reconnect promise is swallowed (logged), never thrown into the dispatcher", async () => {
    const { deps, calls } = makeDeps();
    deps.reconnect = () => Promise.reject(new Error("adapter gone"));
    expect(() => handleMcpTokenMinted(minted("mcp_token-2"), deps)).not.toThrow();
    // The env assignment still happened first.
    expect(calls).toEqual(["env:mcp_token-2"]);
    await Promise.resolve(); // flush the rejection into the catch
    expect(calls).toEqual(["env:mcp_token-2"]);
  });

  it("a malformed mint reply writes nothing and triggers nothing", () => {
    const { deps, calls } = makeDeps();
    for (const bad of [
      { type: "mcp_token_minted" },
      { type: "mcp_token_minted", token: "" },
      { type: "mcp_token_minted", token: 42 },
      { type: "mcp_token_minted", token: null },
    ]) {
      handleMcpTokenMinted(bad as { type: "mcp_token_minted"; token?: unknown }, deps);
    }
    expect(calls).toEqual([]);
  });
});

describe("F3 — connection.status is never a health signal; the mint reply is the sole trigger", () => {
  it("recovery fires identically no matter what status-like state a caller carries", () => {
    // The deps carry NO status input — structurally, there is nothing to
    // branch on. Demonstrate it behaviourally: the same payload produces the
    // same env+reconnect sequence regardless of any ambient status fiction.
    for (const fiction of ["connected", "failed", "needs-auth", "idle"]) {
      const { deps, calls } = makeDeps();
      (
        deps as unknown as { connection: { status: string } }
      ).connection = { status: fiction };
      handleMcpTokenMinted(minted("mcp_token-3"), deps);
      expect(calls).toEqual(["env:mcp_token-3", "reconnect"]);
    }
  });

  it("reconnect is never called without a mint reply (no timer, no poll, no probe)", () => {
    const { deps, calls } = makeDeps();
    // Nothing but handleMcpTokenMinted exists to trigger recovery.
    expect(calls).toEqual([]);
    handleMcpTokenMinted(minted("mcp_token-4"), deps);
    expect(calls.filter((c) => c === "reconnect")).toHaveLength(1);
  });
});

describe("F4 — the plaintext never rides pi.events", () => {
  it("the poisoned emit spy receives nothing while the env assignment happens", () => {
    const { deps, calls } = makeDeps();
    handleMcpTokenMinted(minted("mcp_secret-value"), deps);
    expect(deps.events.emit).not.toHaveBeenCalled();
    expect(calls).toContain("env:mcp_secret-value");
  });

  it("log lines carry the delivery fact, never the credential", () => {
    const lines: string[] = [];
    const log = {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    };
    handleMcpTokenMinted(minted("mcp_secret-value-2"), { ...makeDeps().deps, log });
    for (const line of lines) {
      expect(line).not.toContain("mcp_secret-value-2");
      expect(line).not.toMatch(/mcp_[A-Za-z0-9_-]{20,}/);
    }
    expect(lines.length).toBeGreaterThan(0);
  });

  it("the env var name the provisioned entry re-declares is the one this module writes", () => {
    // The provisioning side writes `env: { PI_DASHBOARD_MCP_TOKEN:
    // "${PI_DASHBOARD_MCP_TOKEN}" }`; the header command reads that same
    // name. This constant is the contract linking all three.
    expect(MCP_TOKEN_ENV_VAR).toBe("PI_DASHBOARD_MCP_TOKEN");
  });
});
