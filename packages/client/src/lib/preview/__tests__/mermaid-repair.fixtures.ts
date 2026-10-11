// Shared repair fixtures. Ported from
// ~/.pi/agent/skills/mermaid-md-doctor/tests/broken.md plus new R1/R7/R2 cases.
// `broken: true` → the original fails mermaid.parse and the repaired source
// parses (asserted by mermaid-repair.parse.test.ts). `broken: false` → valid
// as-is, repair must not be needed. See change: add-mermaid-auto-repair.

export interface RepairFixture {
  name: string;
  src: string;
  broken: boolean;
}

export const FIXTURES: RepairFixture[] = [
  {
    name: "broken.md#1 flowchart edge + node labels (R4, R5)",
    broken: true,
    src: [
      "flowchart TD",
      '  a(["start"]) --> b{"$x != empty"}',
      '  b -->|(empty)| c["retrieve Template"]',
      "  b -->|true| d[call SUB_Do (commit)]",
    ].join("\n"),
  },
  {
    name: "broken.md#2 sequence keyword alias + unclosed blocks (R2, R3)",
    broken: true,
    src: [
      "sequenceDiagram",
      "  actor actor as User",
      "  participant ui as UI",
      "  actor->>ui: Save",
      "  alt ok = true",
      "  ui-->>actor: done",
      "  loop each",
      "  ui-->>actor: row",
    ].join("\n"),
  },
  {
    name: "broken.md#3 erDiagram module-qualified types (R6)",
    broken: true,
    src: ["erDiagram", "  Customer {", "    DomainModels$String Name", "    DomainModels$Integer Age", "  }"].join("\n"),
  },
  {
    // Reclassified: sanitizeMermaidCode decodes single-encoded entities before
    // repair ever runs, so after normalization this block is valid.
    name: "broken.md#4 decoded `&gt;` edge — valid after normalization",
    broken: false,
    src: "flowchart LR\n  A --> B",
  },
  {
    name: "broken.md#5 valid quoted labels",
    broken: false,
    src: 'flowchart LR\n  A["ok"] --> B["fine"]',
  },
  {
    name: "R1 leading `mermaid` line",
    broken: true,
    src: "mermaid\nflowchart LR\n  A --> B",
  },
  {
    name: "R2 participant end inside alt block",
    broken: true,
    src: "sequenceDiagram\n  participant end\n  participant Alice\n  alt ok\n  end->>Alice: y\n  end",
  },
  {
    name: "R5 node label directly followed by an edge",
    broken: true,
    src: "flowchart TD\n  A[call X (commit)]-->B",
  },
];
