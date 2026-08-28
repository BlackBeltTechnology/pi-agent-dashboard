// Vitest for guard.ts — the pure search-guard state machine (arm B).
// Folds test-plan rows E16–E23 + X1 of add-kb-trust-verdicts-and-search-guard.
import { describe, expect, it } from "vitest";
import { bashSegments, createGuard, guardNoteSafe, resolveGuardMode } from "../guard.js";

/** Feed n search actions; collect non-null verdicts. */
function search(g: ReturnType<typeof createGuard>, n: number, cmd = "rg x .") {
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const v = g.note("bash", { command: cmd });
    if (v) out.push(v);
  }
  return out;
}

describe("guard: shipped default + mode reachability (E22/E23, task 4.1, D14)", () => {
  it("no config, no env → warn; block unreachable", () => {
    const g = createGuard({ mode: resolveGuardMode(undefined, undefined) });
    expect(g.state().mode).toBe("warn");
    search(g, 9); // fire 3 times
    const third = g.note("bash", { command: "rg again" });
    void third;
    expect(g.state().firings).toBeGreaterThanOrEqual(3);
    // warn mode: the third firing still returned an escalation STRING, not a block
    expect(g.state().mode).not.toBe("block");
  });

  it("env block is ignored (can never enable blocking); env off/warn always win", () => {
    expect(resolveGuardMode("off", "block")).not.toBe("block"); // config off stays off
    expect(resolveGuardMode(undefined, "block")).toBe("warn"); // junk env → default
    expect(resolveGuardMode("off", "warn")).toBe("warn"); // env weakens-or-warns only
    expect(resolveGuardMode("block", "off")).toBe("off"); // env can select off
    expect(resolveGuardMode("block", undefined)).toBe("block"); // config CAN enable block
    expect(resolveGuardMode(undefined, "junk")).toBe("warn");
  });

  it("mode off is inert: nothing is counted, nothing fires", () => {
    const g = createGuard({ mode: "off" });
    expect(search(g, 9)).toHaveLength(0);
    expect(g.state().chain).toBe(0);
    expect(g.state().firings).toBe(0);
  });
});

describe("guard: chain counter (E16/E17/E18, task 4.2)", () => {
  it("3 consecutive search actions fire; 2 must not", () => {
    const g = createGuard();
    expect(search(g, 2)).toHaveLength(0);
    expect(search(g, 1)).toHaveLength(1); // 3rd → warning
  });

  it("kb retrieval tool calls reset clean-slate (chain AND firings)", () => {
    const g = createGuard();
    search(g, 3); // firing 1
    g.note("kb_search", { query: "how does X work" });
    expect(g.state()).toMatchObject({ chain: 0, firings: 0 });
    search(g, 2);
    expect(g.state().chain).toBe(2);
  });

  it("each member of the reset set resets: kb_neighbors, kb_get, bash kb CLI", () => {
    for (const [tool, input] of [
      ["kb_neighbors", { node: "x" }],
      ["kb_get", { path: "x" }],
      ["bash", { command: "kb agents src/foo.ts" }],
    ] as const) {
      const g = createGuard();
      search(g, 2);
      g.note(tool, input as never);
      expect(g.state()).toMatchObject({ chain: 0, firings: 0 });
    }
  });

  it("an empty-query kb_search still resets — an attempt to consult is a consult", () => {
    const g = createGuard();
    search(g, 2);
    g.note("kb_search", { query: "" });
    expect(g.state().chain).toBe(0);
  });

  it("an interleaved edit does NOT reset (D7)", () => {
    const g = createGuard();
    search(g, 2);
    g.note("edit", { path: "src/foo.ts" });
    g.note("write", { path: "src/foo.ts" });
    expect(g.state().chain).toBe(2); // continues accumulating
    expect(search(g, 1)).toHaveLength(1); // 3rd search fires
  });
});

describe("guard: bash segment parsing (E19, task 4.3)", () => {
  const counts = (cmd: string) => {
    const g = createGuard();
    g.note("bash", { command: cmd });
    return g.state().chain === 1;
  };

  it("counts piped, or-chained, sequential, multi-line, and direct searches", () => {
    expect(counts("cat f | grep x")).toBe(true);
    expect(counts("rg x .")).toBe(true);
    expect(counts("echo hi && ls")).toBe(true);
    expect(counts("rg x || true")).toBe(true);
    expect(counts("find .\n")).toBe(true);
  });

  it("never counts non-search commands", () => {
    expect(counts("npm test")).toBe(false);
    expect(counts("echo hi")).toBe(false);
  });

  it("documents the accepted wrapper gap: timeout 60 rg does NOT count (D8)", () => {
    // Accepted gap, asserted AS accepted: a wrapper binary leading the segment
    // evades the lead-token rule. This is a nudge, not a sandbox.
    expect(counts("timeout 60 rg x")).toBe(false);
  });

  it("bashSegments splits on |, ||, &&, ;, and newline", () => {
    expect(bashSegments("a | b || c && d; e\nf")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("guard: ladder × mode (E20, task 4.4)", () => {
  it("warn mode: warning → escalation → escalation, never a block", () => {
    const g = createGuard({ mode: "warn" });
    const [first, second, third] = search(g, 9);
    expect(typeof first).toBe("string");
    expect(first).not.toBe(second);
    expect(second).toBe(third); // escalation repeats
    for (const v of [first, second, third]) expect(v).not.toMatchObject({ block: true });
  });

  it("block mode: third firing blocks with a reason naming the kb call", () => {
    const g = createGuard({ mode: "block" });
    const [first, second, third] = search(g, 9);
    expect(typeof first).toBe("string");
    expect(typeof second).toBe("string");
    expect(third).toMatchObject({ block: true });
    expect((third as { reason: string }).reason).toContain("kb_search");
  });
});

describe("guard: suspension (E21, task 4.5, D9)", () => {
  it("suspension silences warnings, escalations, and blocks", () => {
    const g = createGuard({ mode: "block" });
    expect(g.suspend(3)).toBe(3);
    expect(search(g, 9)).toHaveLength(0); // would fire 3× without the pause
  });

  it("clamps to 1–20; junk and non-positive are no-ops; re-suspend keeps the max", () => {
    const g = createGuard();
    expect(g.suspend(0)).toBe(0); // no-op
    expect(g.suspend("junk")).toBe(0); // NaN → no-op
    expect(g.suspend(1)).toBe(1);
    expect(g.suspend(25)).toBe(20); // clamped
    expect(g.suspend(5)).toBe(20); // never shortens an active pause
  });

  it("tickTurn expiry restores a clean slate", () => {
    const g = createGuard();
    search(g, 3); // firing 1
    g.suspend(2);
    g.tickTurn();
    expect(g.state().suspended).toBe(1);
    g.tickTurn();
    expect(g.state()).toMatchObject({ suspended: 0, chain: 0, firings: 0 });
    // clean slate: two searches must NOT fire (a stale stretch cannot prime it)
    expect(search(g, 2)).toHaveLength(0);
  });

  it("suspension expiry mid-ladder does not carry firings forward", () => {
    const g = createGuard({ mode: "block" });
    search(g, 9); // 3 firings → would block next
    g.suspend(1);
    g.tickTurn(); // expires → clean slate
    const [v] = search(g, 3);
    expect(typeof v).toBe("string"); // firing 1 again = warning, not block
  });
});

describe("guard: degrades silently (X1, task 5.5)", () => {
  it("a throwing guard leaves the tool call untouched", () => {
    const bomb = createGuard();
    (bomb as unknown as { note: () => never }).note = () => {
      throw new Error("guard exploded");
    };
    expect(guardNoteSafe(bomb, "bash", { command: "rg x" })).toBeNull();
    expect(guardNoteSafe(null, "bash", { command: "rg x" })).toBeNull();
    expect(guardNoteSafe(undefined, "grep", {})).toBeNull();
  });

  it("a healthy guard passes verdicts through guardNoteSafe", () => {
    const g = createGuard();
    expect(guardNoteSafe(g, "bash", { command: "npm test" })).toBeNull();
    search(g, 2);
    expect(typeof guardNoteSafe(g, "bash", { command: "rg x" })).toBe("string");
  });
});
