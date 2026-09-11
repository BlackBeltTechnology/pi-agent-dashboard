// before_agent_start hook wiring (change: inject-dox-doctrine-and-describe,
// test-plan #E18–#E21, #X1, #X2, #P1). Fake pi captures the registered handler;
// temp cwd + isolated HOME give deterministic config resolution.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOX_DELIMITER } from "../doctrine.js";
import kbExtension from "../extension.js";

type Hook = (event: unknown) => { systemPrompt?: string } | undefined;

/** Load the extension against a fake pi and return its before_agent_start hook. */
function loadHook(): Hook {
  const hooks: Hook[] = [];
  const pi = {
    registerTool: () => {},
    on: (evt: string, fn: Hook) => {
      if (evt === "before_agent_start") hooks.push(fn);
    },
    sendMessage: () => {},
  } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  return hooks[0];
}

const BASE = "A\nCurrent working directory: /x\n";
const event = (cwd: string, contextFiles?: unknown) => ({
  systemPrompt: BASE,
  systemPromptOptions: { cwd, contextFiles },
});
const promptOf = (out: { systemPrompt?: string } | undefined) => out?.systemPrompt ?? BASE;

let home: string;
let cwd: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kb-hook-home-"));
  cwd = mkdtempSync(join(tmpdir(), "kb-hook-cwd-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
  delete process.env.KB_DOCTRINE_PATH;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  delete process.env.KB_DOCTRINE_PATH;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function writeProject(cfg: unknown): void {
  mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}
function writeGlobal(cfg: unknown): void {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(home, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}

describe("E18: first-contact nudge fires once per session", () => {
  it("turn 1 has the nudge, turn 2 does not", () => {
    const hook = loadHook();
    const t1 = promptOf(hook(event(cwd)));
    expect(t1).toContain("kb read");
    expect(t1).toContain("kb read + write");
    expect(t1).toContain("off");
    expect(t1).toContain("ask later");
    expect(t1).toContain(".pi/dashboard/knowledge_base.json");
    expect(t1.toLowerCase()).toContain("non-interactive");
    expect(t1).toContain(DOX_DELIMITER); // defaults inject READ

    const t2 = promptOf(hook(event(cwd)));
    expect(t2).not.toContain("which mode to enable");
  });
});

describe("E19: legacy seed → migration nudge, no doctrine fragment", () => {
  it("skips injection and offers migration", () => {
    const hook = loadHook();
    const legacy = [{ path: "AGENTS.md", content: "<!-- dox:write:start -->\nX\n<!-- dox:write:end -->" }];
    const out = promptOf(hook(event(cwd, legacy)));
    expect(out).not.toContain(DOX_DELIMITER);
    expect(out).toContain("legacy copy");
    expect(out).not.toContain("which mode to enable"); // first-contact absent
  });
});

describe("E20: legacy seed + inject off → nothing", () => {
  it("no fragment, no nudges", () => {
    writeProject({ doctrine: { inject: "off" } });
    const hook = loadHook();
    const legacy = [{ content: "<!-- dox:read:manual:start -->\nX" }];
    const out = hook(event(cwd, legacy));
    expect(out).toBeUndefined();
  });
});

describe("E21: config resolved per turn", () => {
  it("writing doctrine between turns changes the next turn's fragment", () => {
    const hook = loadHook();
    const t1 = promptOf(hook(event(cwd)));
    expect(t1).not.toContain("Documentation Update Protocol (WRITE discipline)");

    writeProject({ doctrine: { inject: "kb", write: true } });
    const t2 = promptOf(hook(event(cwd)));
    expect(t2).toContain("Documentation Update Protocol (WRITE discipline)");
  });
});

describe("X1: malformed project config", () => {
  it("falls back to READ-only defaults, no nudge, warns once", () => {
    mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), '{"doctrine": ');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hook = loadHook();
      for (let i = 0; i < 3; i++) {
        const out = promptOf(hook(event(cwd)));
        expect(out).toContain(DOX_DELIMITER); // READ present
        expect(out).not.toContain("Documentation Update Protocol (WRITE discipline)");
        expect(out).not.toContain("which mode to enable"); // no nudge
      }
      const kbWarns = warn.mock.calls.filter((c) => String(c[0]).startsWith("[kb]"));
      expect(kbWarns).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("X2: unreadable doctrine file", () => {
  it("leaves the prompt unchanged and warns once", () => {
    process.env.KB_DOCTRINE_PATH = join(cwd, "does-not-exist.md");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hook = loadHook();
      expect(hook(event(cwd))).toBeUndefined(); // prompt unchanged
      expect(hook(event(cwd))).toBeUndefined();
      const kbWarns = warn.mock.calls.filter((c) => String(c[0]).startsWith("[kb]"));
      expect(kbWarns).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("P1: handler latency", () => {
  it("p95 wall time over 100 warm turns is < 20 ms", () => {
    writeGlobal({ doctrine: { inject: "kb" } });
    writeProject({ doctrine: { inject: "kb", write: true } });
    const hook = loadHook();
    // warm up
    for (let i = 0; i < 5; i++) hook(event(cwd));
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      hook(event(cwd));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]; // 95th of 100 (index 94)
    expect(p95).toBeLessThan(20);
  });
});
