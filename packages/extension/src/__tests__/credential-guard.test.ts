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

// ── harden-agent-tool-guards D1: provider secrets (T.1–T.11) ──────────────────
describe("T.1: provider secrets × tool × dir", () => {
  const FILES = ["auth.json", "mcp-auth.json", "providers.json", "system-one/auth.json"];
  const TOOLS = ["read", "edit", "write", "ls", "find", "grep"];
  it("blocks all 48 combinations with a path-free log line", () => {
    for (const dir of [nodePath.join(home, ".pi", "agent"), "/srv/pi-agent"]) {
      const env = dir === "/srv/pi-agent" ? { PI_CODING_AGENT_DIR: dir } : {};
      for (const f of FILES) for (const tool of TOOLS) {
        logs.length = 0;
        const { call } = make(env);
        const r = blocked(call(tool, { path: nodePath.join(dir, f), pattern: "x" }));
        expect(r, `${tool} ${dir}/${f}`).toMatchObject({ block: true });
        expect(r?.reason.startsWith("credential_guard")).toBe(true);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^\[credential-guard\] blocked tool=[a-z]+ match=[a-z-]+$/);
        expect(logs[0]).not.toContain(f);
      }
    }
  });
});

describe("T.2: sibling rule <name>.*", () => {
  it("blocks dotted siblings, not look-alikes or `..` escapes", () => {
    const { call } = make();
    const a = nodePath.join(home, ".pi", "agent");
    for (const t of ["auth.json.bak", "providers.json.corrupt-20260101T000000Z", "system-one/auth.json.lock", "mcp-auth.json."]) {
      expect(blocked(call("read", { path: nodePath.join(a, t) })), t).toMatchObject({ block: true });
    }
    for (const t of ["xauth.json", "system-one/author.json", "auth.json/../settings.json"]) {
      expect(call("read", { path: nodePath.join(a, t) }), t).toBeUndefined();
    }
  });
});

describe("T.3: path forms", () => {
  it("blocks cwd-relative, dot-dot, trailing-slash override and symlinked forms", () => {
    const a = nodePath.join(home, ".pi", "agent");
    const { call } = make();
    expect(blocked(call("read", { path: "auth.json" }, a))?.block).toBe(true);
    expect(blocked(call("read", { path: "./system-one/auth.json" }, a))?.block).toBe(true);
    expect(blocked(call("edit", { path: nodePath.join(a, "x", "..", "auth.json") }))?.block).toBe(true);
    const o = make({ PI_CODING_AGENT_DIR: "/srv/pi-agent/" });
    expect(blocked(o.call("read", { path: "/srv/pi-agent/providers.json" }))?.block).toBe(true);
    if (process.platform !== "win32") {
      fs.mkdirSync(a, { recursive: true });
      fs.writeFileSync(nodePath.join(a, "auth.json"), "x");
      const w = nodePath.join(home, "w");
      fs.mkdirSync(w);
      fs.symlinkSync(nodePath.join(a, "auth.json"), nodePath.join(w, "l"));
      expect(blocked(call("read", { path: nodePath.join(w, "l") }))?.block).toBe(true);
    }
  });
});

describe("T.4: text rule for provider secrets", () => {
  it("blocks full-path references, never bare names", () => {
    const { call } = make();
    for (const command of [
      "cat ~/.pi/agent/auth.json | head",
      "CAT ~/.PI/AGENT/AUTH.JSON",
      "type %USERPROFILE%\\.pi\\agent\\providers.json",
      "cat ~/.pi/agent/system-one/auth.json.bak",
    ]) expect(blocked(call("bash", { command }))?.block, command).toBe(true);
    for (const command of ["rg auth.json packages/", "rg providers.json docs/", "ls ~/.pi/agent", "cat auth.json"]) {
      expect(call("bash", { command }), command).toBeUndefined();
    }
  });
});

describe("T.5: PI_CODING_AGENT_DIR needles", () => {
  it("matches the override full path only when the env is set", () => {
    for (const dir of ["/srv/pi-agent", "/srv/pi-agent/"]) {
      const { call } = make({ PI_CODING_AGENT_DIR: dir });
      expect(blocked(call("bash", { command: "cat /srv/pi-agent/auth.json" }))?.block, dir).toBe(true);
      expect(blocked(call("bash", { command: "cat /srv/pi-agent/system-one/auth.json" }))?.block, dir).toBe(true);
      expect(call("bash", { command: "cat /srv/pi-agent/settings.json" }), dir).toBeUndefined();
    }
    const unset = make({});
    expect(unset.call("bash", { command: "cat /srv/pi-agent/auth.json" })).toBeUndefined();
  });
});

describe("T.6: needle list has no index coupling", () => {
  it("keeps plugin-credentials and vault blocked in every env state; `ls /tmp` stays allowed", () => {
    const states: NodeJS.ProcessEnv[] = [
      {},
      { PI_CODING_AGENT_DIR: "/srv/pi-agent" },
      { PI_DASHBOARD_DATA_KEY_FILE: "/k/data-key" },
      { PI_CODING_AGENT_DIR: "/srv/pi-agent", PI_DASHBOARD_DATA_KEY_FILE: "/k/data-key" },
    ];
    for (const env of states) {
      const { call } = make(env);
      expect(blocked(call("bash", { command: "cat ~/.pi/agent/plugin-credentials.json" }))?.block, JSON.stringify(env)).toBe(true);
      expect(blocked(call("bash", { command: "cat ~/.pi/dashboard/vault.json" }))?.block, JSON.stringify(env)).toBe(true);
      expect(call("bash", { command: "ls /tmp" }), JSON.stringify(env)).toBeUndefined();
    }
  });
});

describe("T.7: write/edit content is exempt for provider secrets", () => {
  it("allows quoting in content, blocks the path", () => {
    const { call } = make();
    expect(call("write", { path: "/w/notes.md", content: "see ~/.pi/agent/auth.json" })).toBeUndefined();
    expect(call("edit", { path: "/w/notes.md", oldText: "a", newText: "see .pi/agent/providers.json" })).toBeUndefined();
    expect(blocked(call("write", { path: "~/.pi/agent/auth.json", content: "x" }))?.block).toBe(true);
  });
});

describe("T.8: extension tools", () => {
  it("blocks MCP/extension tool inputs naming a secret (text-path)", () => {
    const { call } = make();
    expect(blocked(call("ctx_execute_file", { path: "/home/u/.pi/agent/system-one/auth.json" }))?.block).toBe(true);
    expect(blocked(call("grep", { path: "/w/repo", pattern: "x", glob: "/home/u/.pi/agent/mcp-auth.json" }))?.block).toBe(true);
  });
});

describe("T.9: grep directory rule", () => {
  it("is grep-only and covers the nested dir", () => {
    const a = nodePath.join(home, ".pi", "agent");
    const { call } = make();
    expect(blocked(call("grep", { pattern: "k", path: nodePath.join(a, "system-one") }))?.block).toBe(true);
    expect(blocked(call("grep", { pattern: "k", path: a }))?.block).toBe(true);
    expect(call("grep", { pattern: "k", path: nodePath.join(a, "skills") })).toBeUndefined();
    expect(call("ls", { path: nodePath.join(a, "system-one") })).toBeUndefined();
    expect(call("find", { pattern: "*", path: nodePath.join(a, "system-one") })).toBeUndefined();
  });
});

describe("T.10: non-secret files are not blocked by the credential guard", () => {
  it("settings.json, trust.json, models.json, mcp.json pass", () => {
    const { call } = make();
    for (const f of ["settings.json", "trust.json", "models.json", "mcp.json"]) {
      expect(call("read", { path: nodePath.join(home, ".pi", "agent", f) }), f).toBeUndefined();
    }
  });
});

describe("T.11: PI_CODING_AGENT_DIR spelled with a leading `~`; a third agent dir stays a residual", () => {
  it("expands `~` like pi does, so the real auth.json is blocked (file and text rules)", () => {
    const { call } = make({ PI_CODING_AGENT_DIR: "~/alt-agent" });
    expect(blocked(call("read", { path: nodePath.join(home, "alt-agent", "auth.json") }))?.block).toBe(true);
    expect(blocked(call("bash", { command: `cat ${nodePath.join(home, "alt-agent", "auth.json")}` }))?.block).toBe(true);
    expect(blocked(call("bash", { command: "cat ~/alt-agent/auth.json" }))?.block).toBe(true);
    expect(call("read", { path: nodePath.join(home, "alt-agent", "settings.json") })).toBeUndefined();
  });
  it("still does not block a third agent dir reported only by pi (recorded residual)", () => {
    const { call } = make({});
    expect(call("read", { path: "/opt/third/auth.json" })).toBeUndefined();
  });
});

describe("T.113: fault injection — canonicalize throws / over-deep input", () => {
  it("blocks only the faulty call, then recovers; the log carries no path", () => {
    let boom = true;
    const { call } = make({}, {
      canonicalize: (p: string) => {
        if (boom) throw new Error("boom /secret/path");
        return p;
      },
    });
    expect(blocked(call("read", { path: "/w/a.txt" }))?.reason).toContain("could not be checked");
    boom = false;
    expect(call("read", { path: "/w/ordinary.txt" })).toBeUndefined();
    expect(logs.join("\n")).not.toContain("/secret/path");

    let deep: Record<string, unknown> = { command: "ls" };
    for (let i = 0; i < 40; i++) deep = { opts: deep };
    const r = blocked(call("mcp_tool", deep));
    expect(r?.block).toBe(true);
    expect(logs.some((l) => l.includes("match=depth"))).toBe(true);
    expect(call("read", { path: "/w/next.txt" })).toBeUndefined();
  });
});

describe("T.114: fault injection — odd PI_CODING_AGENT_DIR", () => {
  it("missing dir is canonicalised lexically and blocked", () => {
    const { call } = make({ PI_CODING_AGENT_DIR: nodePath.join(home, "nope", "agent") });
    expect(blocked(call("read", { path: nodePath.join(home, "nope", "agent", "auth.json") }))?.block).toBe(true);
  });
  it.skipIf(process.platform === "win32")("dangling symlink and symlink loop never allow", () => {
    const dangling = nodePath.join(home, "dangling");
    fs.symlinkSync(nodePath.join(home, "gone"), dangling);
    const a = make({ PI_CODING_AGENT_DIR: dangling });
    expect(blocked(a.call("read", { path: nodePath.join(dangling, "auth.json") }))?.block).toBe(true);
    const l1 = nodePath.join(home, "l1");
    const l2 = nodePath.join(home, "l2");
    fs.symlinkSync(l2, l1);
    fs.symlinkSync(l1, l2);
    const b = make({ PI_CODING_AGENT_DIR: l1 });
    expect(blocked(b.call("read", { path: nodePath.join(l1, "auth.json") }))?.block).toBe(true);
  });
});

describe("T.95 per-call cost with both agent dirs set", () => {
  it("1000 read calls: p95 < 1 ms (best of several batches, so a loaded CI host does not flake a real budget)", () => {
    const { call } = make({ PI_CODING_AGENT_DIR: "/srv/pi-agent" });
    const target = nodePath.join(home, "work", "a.ts");
    for (let i = 0; i < 100; i++) call("read", { path: target }); // warm-up (JIT, fs caches)
    const batch = (): number => {
      const t: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const s = performance.now();
        call("read", { path: target });
        t.push(performance.now() - s);
      }
      t.sort((a, b) => a - b);
      return t[Math.floor(t.length * 0.95)];
    };
    expect(Math.min(...Array.from({ length: 6 }, batch))).toBeLessThan(1);
  });
});
