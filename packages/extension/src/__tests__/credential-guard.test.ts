/**
 * Agent credential guard (encrypt-credentials-at-rest D12): handler-level tests.
 * Rows E49–E52, E55–E63, X15, X16. E48/E53/E54 live in `credential-guard-wiring.test.ts`.
 * Harness copied from `path-gate/__tests__/handler.test.ts` conventions: `tool_call`
 * event fixtures + `ctx.cwd`, with a temp HOME so no real path is touched.
 * See change: encrypt-credentials-at-rest.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialGuard } from "../credential-guard.js";

let home: string;
let logs: string[];

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "cg-home-")));
  logs = [];
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const plugin = () => nodePath.join(home, ".pi", "agent", "plugin-credentials.json");
const vault = () => nodePath.join(home, ".pi", "dashboard", "vault.json");

function make(env: NodeJS.ProcessEnv = {}, extra: Record<string, unknown> = {}) {
  const guard = createCredentialGuard({ env, homedir: home, log: (l: string) => logs.push(l), ...extra } as never);
  const call = (toolName: string, input: unknown, cwd = nodePath.join(home, "work")) =>
    guard.handler({ toolName, toolCallId: "tc", input }, { cwd, hasUI: true });
  return { guard, call };
}
const blocked = (r: unknown) => r as { block: boolean; reason: string } | undefined;

describe("E49: path tools × targets", () => {
  const keyFile = () => nodePath.join(home, "keys", "data-key");
  const customAgent = () => nodePath.join(home, "custom-agent");
  const env = () => ({ PI_DASHBOARD_DATA_KEY_FILE: keyFile(), PI_CODING_AGENT_DIR: customAgent() });
  const protectedTargets = () => [
    plugin(),
    vault(),
    keyFile(),
    `${vault()}.corrupt-20260101T000000Z`,
    `${vault()}.lock`,
    `${plugin()}.undecryptable-x`,
    nodePath.join(customAgent(), "plugin-credentials.json"),
  ];

  it("blocks every tool × protected target, allows settings.json", () => {
    const { call } = make(env());
    for (const tool of ["read", "edit", "write", "ls", "find", "grep"]) {
      for (const target of protectedTargets()) {
        const r = blocked(call(tool, { path: target, pattern: "x" }));
        expect(r, `${tool} ${target}`).toMatchObject({ block: true });
        expect(r?.reason.startsWith("credential_guard")).toBe(true);
      }
      expect(call(tool, { path: nodePath.join(home, ".pi", "agent", "settings.json"), pattern: "x" }), tool).toBeUndefined();
    }
  });

  it("expands ~ like pi does", () => {
    const { call } = make({}, { homedir: home });
    expect(blocked(call("read", { path: "~/.pi/agent/plugin-credentials.json" }))?.block).toBe(true);
  });
});

describe("E50: symlink canonicalised", () => {
  it.skipIf(process.platform === "win32")("blocks a read through a symlink to the vault", () => {
    fs.mkdirSync(nodePath.dirname(vault()), { recursive: true });
    fs.writeFileSync(vault(), "x");
    const w = nodePath.join(home, "w");
    fs.mkdirSync(w);
    fs.symlinkSync(vault(), nodePath.join(w, "link"));
    const { call } = make();
    expect(blocked(call("read", { path: nodePath.join(w, "link") }))?.block).toBe(true);
  });
});

describe("E51: grep directory rule", () => {
  it("blocks the dirs that directly contain a protected file, allows ~/.pi and ~", () => {
    const { call } = make();
    expect(blocked(call("grep", { pattern: "k", path: nodePath.join(home, ".pi", "agent") }))?.block).toBe(true);
    expect(blocked(call("grep", { pattern: "k", path: nodePath.join(home, ".pi", "dashboard") }))?.block).toBe(true);
    expect(call("grep", { pattern: "k", path: nodePath.join(home, ".pi") })).toBeUndefined();
    expect(call("grep", { pattern: "k", path: home })).toBeUndefined();
  });
});

describe("E52: missing path = cwd", () => {
  it("grep with no path / empty path decides on ctx.cwd; find/ls on a directory allow", () => {
    const { call } = make();
    const dash = nodePath.join(home, ".pi", "dashboard");
    expect(blocked(call("grep", { pattern: "k" }, dash))?.block).toBe(true);
    expect(blocked(call("grep", { pattern: "k", path: "" }, dash))?.block).toBe(true);
    expect(call("grep", { pattern: "k" }, nodePath.join(home, "repo"))).toBeUndefined();
    expect(call("grep", { pattern: "k", path: "" }, nodePath.join(home, "repo"))).toBeUndefined();
    const agent = nodePath.join(home, ".pi", "agent");
    expect(call("find", { pattern: "*.ts" }, agent)).toBeUndefined();
    expect(call("ls", {}, agent)).toBeUndefined();
  });
});

describe("E55: scanned fields", () => {
  const P = "/home/u/.pi/dashboard/vault.json";
  it("blocks the 11 listed fields and nested {opts:{command}}", () => {
    const { call } = make();
    const fields = ["command", "script", "code", "url", "path", "file", "filePath", "cwd", "pattern", "glob"];
    for (const f of fields) expect(blocked(call("mcp_tool", { [f]: P }))?.block, f).toBe(true);
    expect(blocked(call("mcp_tool", { args: ["--x", P] }))?.block, "args[1]").toBe(true);
    expect(blocked(call("mcp_tool", { opts: { command: P } }))?.block, "nested").toBe(true);
  });
  it("allows description / query / message", () => {
    const { call } = make();
    for (const f of ["description", "query", "message"]) expect(call("mcp_tool", { [f]: P }), f).toBeUndefined();
  });
});

describe("E56: write/edit content exempt", () => {
  const Q = "see ~/.pi/dashboard/vault.json";
  it("allows quoting in content fields, blocks the path rule", () => {
    const { call } = make();
    expect(call("edit", { path: "docs/credential-vault.md", newText: Q, oldText: Q })).toBeUndefined();
    expect(call("edit", { path: "docs/credential-vault.md", edits: [{ oldText: "a", newText: Q }] })).toBeUndefined();
    expect(call("write", { path: "docs/x.md", content: Q })).toBeUndefined();
    expect(blocked(call("write", { path: vault(), content: "x" }))?.block).toBe(true);
  });
});

describe("E57: path-like text matches", () => {
  it("blocks the listed forms", () => {
    const { call } = make({ PI_DASHBOARD_DATA_KEY_FILE: "/home/pi/.pi-key/data-key" });
    const cases: Array<[string, unknown]> = [
      ["bash", { command: "cat ~/.pi/dashboard/vault.json" }],
      ["bash", { command: "type %USERPROFILE%\\.pi\\dashboard\\vault.json" }],
      ["bash", { command: "CAT ~/.PI/DASHBOARD/VAULT.JSON" }],
      ["bash", { command: "cp ~/.pi/dashboard/vault.json.corrupt-x /tmp" }],
      ["fetch", { url: "file:///home/u/.pi/dashboard/vault.json" }],
      ["ctx_execute_file", { path: "/home/u/.pi/dashboard/vault.json" }],
      ["grep", { path: "/w/repo", pattern: "x", glob: "/home/u/.pi/agent/plugin-credentials.json" }],
      ["bash", { command: "cat /home/pi/.pi-key/data-key" }],
    ];
    for (const [tool, input] of cases) expect(blocked(call(tool, input))?.block, JSON.stringify(input)).toBe(true);
  });
});

describe("E58: no bare-name false positive", () => {
  it("allows", () => {
    const { call } = make({}); // key-file env unset in pi
    for (const command of [
      "ls ~/.pi/agent",
      "rg plugin-credentials.json docs/",
      'git commit -m "touch vault.json"',
      "cat /home/pi/.pi-key/data-key",
    ]) expect(call("bash", { command }), command).toBeUndefined();
  });
});

describe("E59: accepted false positive pinned", () => {
  it("blocks a commit message quoting the full path", () => {
    const { call } = make();
    const r = blocked(call("bash", { command: 'git commit -m "see ~/.pi/dashboard/vault.json"' }));
    expect(r?.block).toBe(true);
    expect(r?.reason.startsWith("credential_guard")).toBe(true);
  });
});

describe("E60: keychain / dump / decrypt rules", () => {
  it("blocks", () => {
    const { call } = make();
    for (const command of [
      "security find-generic-password -s pi-dashboard-credential-key -w",
      "secret-tool lookup service pi-dashboard-credential-key username data-key-v1",
      "cmdkey /list:pi-dashboard-credential-key",
      "Get-StoredCredential -Target pi-dashboard-credential-key",
      "security   dump-keychain",
      "pi-dashboard  credentials   decrypt --yes",
      "credentials\tdecrypt",
    ]) expect(blocked(call("bash", { command }))?.block, command).toBe(true);
  });
});

describe("E61: keychain rule negatives", () => {
  it("allows", () => {
    const { call } = make();
    for (const command of [
      "security find-generic-password -s pi-dashboard -w",
      "echo pi-dashboard-credential-key",
      "pi-dashboard credentials status",
    ]) expect(call("bash", { command }), command).toBeUndefined();
  });
});

describe("E62: bypass residuals pinned", () => {
  it("allows the documented bypasses (the guard is not a sandbox)", () => {
    const { call } = make();
    for (const command of [
      "cd ~/.pi/dashboard && cat vault.json",
      "f=vault; cat ~/.pi/dashboard/$f.json",
      "echo fi8ucGkvZGFzaGJvYXJkL3ZhdWx0Lmpzb24= | base64 -d | xargs cat",
    ]) expect(call("bash", { command }), command).toBeUndefined();
  });
});

describe("E63: PI_CODING_AGENT_DIR", () => {
  it("blocks the read and the bash cat under the custom agent dir", () => {
    const { call } = make({ PI_CODING_AGENT_DIR: "/custom/agent" });
    expect(blocked(call("read", { path: "/custom/agent/plugin-credentials.json" }))?.block).toBe(true);
    expect(blocked(call("bash", { command: "cat /custom/agent/plugin-credentials.json" }))?.block).toBe(true);
  });
});

describe("X15: guard internal error", () => {
  it("blocks only the call being evaluated and logs without detail; the next call is allowed", () => {
    let n = 0;
    const { call } = make({}, {
      canonicalize: (p: string) => {
        if (n++ === 0) throw new Error("boom /secret/detail");
        return p;
      },
    });
    const r = blocked(call("read", { path: nodePath.join(home, "anything.txt") }));
    expect(r?.block).toBe(true);
    expect(r?.reason.startsWith("credential_guard")).toBe(true);
    expect(logs.filter((l) => l.startsWith("[credential-guard] error tool=read"))).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("/secret/detail");
    expect(call("read", { path: nodePath.join(home, "README.md") })).toBeUndefined();
  });
});

describe("X16: guard log hygiene", () => {
  it("one line naming tool and rule, no command text", () => {
    const { call } = make();
    call("bash", { command: "cat ~/.pi/dashboard/vault.json | base64" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^\[credential-guard\] blocked tool=bash match=[a-z-]+$/);
    for (const forbidden of ["base64", "cat", "vault.json"]) expect(logs[0]).not.toContain(forbidden);
  });
});
