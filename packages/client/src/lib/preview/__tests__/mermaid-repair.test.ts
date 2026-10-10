// See change: add-mermaid-auto-repair (test-plan E1–E13, P1, P2).
import { describe, expect, it } from "vitest";
import { repairMermaid } from "../mermaid-repair.js";
import { FIXTURES } from "./mermaid-repair.fixtures.js";

describe("repairMermaid — R1 header", () => {
  it("strips BOM / zero-width chars and a leading `mermaid` line (E1)", () => {
    const bom = repairMermaid("\ufeffgraph TD\nA-->B");
    expect(bom.code).toBe("graph TD\nA-->B");
    expect(bom.applied).toEqual(["R1"]);

    const zw = repairMermaid("graph TD\nA\u200c-->B");
    expect(zw.code).toBe("graph TD\nA-->B");
    expect(zw.applied).toEqual(["R1"]);

    const word = repairMermaid("mermaid\ngraph TD\nA-->B");
    expect(word.code).toBe("graph TD\nA-->B");
    expect(word.applied).toEqual(["R1"]);
  });
});

describe("repairMermaid — R2 keyword aliases", () => {
  it("renames a keyword alias in declaration and messages (E2)", () => {
    const r = repairMermaid("sequenceDiagram\nparticipant end\nAlice->>end: hi");
    expect(r.code).toBe("sequenceDiagram\nparticipant p_end\nAlice->>p_end: hi");
    expect(r.applied).toContain("R2");
  });

  it("never renames a bare `end` terminator line (E3)", () => {
    const r = repairMermaid("sequenceDiagram\nparticipant end\nalt ok\nend->>Alice: y\nend");
    const lines = r.code.split("\n");
    expect(lines).toEqual(["sequenceDiagram", "participant p_end", "alt ok", "p_end->>Alice: y", "end"]);
  });

  it("picks a collision-free alias (E4)", () => {
    const r = repairMermaid("sequenceDiagram\nparticipant end\nparticipant p_end\nend->>p_end: hi");
    expect(r.code).toContain("participant p_end_2");
    expect(r.code).toContain("p_end_2->>p_end: hi");
    const ids = [...r.code.matchAll(/^participant (\w+)/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("repairMermaid — R3 sequence blocks", () => {
  it("balances unclosed and surplus blocks (E5)", () => {
    const one = repairMermaid("sequenceDiagram\nA->>B: x\nalt ok\nB-->>A: y");
    expect(one.code.split("\n").filter((l) => l.trim() === "end")).toHaveLength(1);
    expect(one.code.endsWith("end")).toBe(true);
    expect(one.applied).toContain("R3");

    const two = repairMermaid("sequenceDiagram\nalt ok\nA->>B: x\nloop each\nB-->>A: y");
    expect(two.code.split("\n").filter((l) => l.trim() === "end")).toHaveLength(2);
    expect(two.applied).toContain("R3");

    const surplus = repairMermaid("sequenceDiagram\nA->>B: x\nend\nB-->>A: y");
    expect(surplus.code).toBe("sequenceDiagram\nA->>B: x\nB-->>A: y");
    expect(surplus.applied).toContain("R3");
  });
});

describe("repairMermaid — R6 ER types", () => {
  it("bares an attribute type with non-word chars (E6)", () => {
    const r = repairMermaid("erDiagram\nA {\n  DomainModels$String Name\n}");
    expect(r.code).toBe("erDiagram\nA {\n  String Name\n}");
    expect(r.applied).toEqual(["R6"]);
  });
});

describe("repairMermaid — R4 edge labels", () => {
  it("quotes labels attached to an edge operator, idempotently (E7)", () => {
    const one = repairMermaid("flowchart TD\nA -->|(empty)| B");
    expect(one.code).toContain('A -->|"(empty)"| B');
    expect(one.applied).toContain("R4");

    const two = repairMermaid("flowchart TD\nA -->|yes| B -->|no| C");
    expect(two.code).toContain('A -->|"yes"| B -->|"no"| C');
    expect(repairMermaid(two.code).applied).toEqual([]);
  });

  it("leaves pipes inside a quoted label alone (E8)", () => {
    const r = repairMermaid('flowchart TD\nA["a|b|c"] --> B(x (y))');
    expect(r.code).toContain('A["a|b|c"]');
  });
});

describe("repairMermaid — R5 node labels", () => {
  it("quotes special-char labels in every trailing context (E9)", () => {
    expect(repairMermaid("flowchart TD\nA[call X (commit)] --> B").code).toContain('A["call X (commit)"] --> B');
    expect(repairMermaid("flowchart TD\nA[call X (commit)]-->B").code).toContain('A["call X (commit)"]-->B');
    expect(repairMermaid("flowchart TD\nA[call X (commit)]").code).toBe('flowchart TD\nA["call X (commit)"]');
    expect(repairMermaid("flowchart TD\nA --> B{a > b}").code).toContain('B{"a > b"}');
  });

  it("never re-quotes inside an already quoted label (E10)", () => {
    const first = repairMermaid('flowchart TD\nA["x(y;)"] --> B[z (w)]');
    expect(first.code).toContain('B["z (w)"]');
    // A keeps its single pair of quotes — R5 never nests/re-quotes it. Its `;`
    // is replaced by R7 per spec (quoted labels: `;`→`,`), not by R5.
    expect(first.code).toMatch(/^A\["x\(y[;,]\)"\] -->/m);
    expect(first.code).not.toContain('""');
    const second = repairMermaid(first.code);
    expect(second.applied).toEqual([]);
    expect(second.code).toBe(first.code);
  });

  it("does not touch shape delimiters without special chars", () => {
    const src = "flowchart TD\nA((circle)) --> B([stadium]) --> C{{hex}} --> D[[sub]] --> E[(db)]\nF[x (y)]";
    const r = repairMermaid(src);
    expect(r.code).toContain("A((circle)) --> B([stadium]) --> C{{hex}} --> D[[sub]] --> E[(db)]");
    expect(r.code).toContain('F["x (y)"]');
  });
});

describe("repairMermaid — R7 quoted label chars", () => {
  it("replaces `;` and `#` but keeps entity escapes (E11)", () => {
    const r = repairMermaid('flowchart TD\nA["say #quot;hi#quot;; no #1"] --> B');
    expect(r.code).toContain('A["say #quot;hi#quot;, no no.1"]');
    expect(r.applied).toContain("R7");
  });
});

describe("repairMermaid — kind detection (E12)", () => {
  it.each([
    ["frontmatter + flowchart", "---\ntitle: T\n---\nflowchart TD\nA[x (y)] --> B", true],
    ["flowchart-elk", "flowchart-elk TD\nA[x (y)] --> B", true],
    ["%% comment first", "%% note\nflowchart TD\nA[x (y)] --> B", true],
    ["erDiagram with bracket text", "erDiagram\nA[x (y)] --> B", false],
  ])("%s → flowchart rules fire: %s", (_name, src, fires) => {
    const r = repairMermaid(src);
    expect(r.applied.includes("R5")).toBe(fires);
    expect(r.code.includes('A["x (y)"]')).toBe(fires);
  });
});

// Seeded PRNG (mulberry32) so the property test is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("repairMermaid — purity / idempotence (E13)", () => {
  const ALPHABET = '[]()|"{};#-> \nABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rand = mulberry32(0xc0ffee);
  const randoms: string[] = [];
  for (let i = 0; i < 200; i++) {
    const len = 5 + Math.floor(rand() * 80);
    let s = "";
    for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    randoms.push(`${i % 2 === 0 ? "graph TD" : "sequenceDiagram"}\n${s}`);
  }
  const inputs = [...FIXTURES.map((f) => f.src), ...randoms];

  it("repair(repair(x)) applies nothing and repeat calls are deep-equal", () => {
    for (const x of inputs) {
      const r1 = repairMermaid(x);
      const r2 = repairMermaid(r1.code);
      expect(r2.applied, JSON.stringify(x)).toEqual([]);
      expect(r2.code, JSON.stringify(x)).toBe(r1.code);
      expect(repairMermaid(x)).toEqual(r1);
    }
  });
});

function medianMs(fn: () => void): number {
  fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[2];
}

describe("repairMermaid — bounded in time", () => {
  it("near-limit 50 000-char flowchart repairs in < 100 ms (P1)", () => {
    let src = "flowchart TD\n";
    while (src.length < 50_000) src += "A[x (y)] -->|z| B\n";
    src = src.slice(0, 50_000);
    expect(medianMs(() => repairMermaid(src))).toBeLessThan(100);
  });

  it("pathological 50 000-char line repairs in < 100 ms (P2)", () => {
    const unit = '[(|"';
    const src = `graph TD\n${unit.repeat(12_500)}`;
    expect(medianMs(() => repairMermaid(src))).toBeLessThan(100);
  });
});
