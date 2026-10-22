/**
 * Fixture documents for the Trusted Types specs (change: harden-client-sinks,
 * design D9). Seeded into the harness repo per spec and removed afterwards.
 */

const fence = (body: string) => `\`\`\`mermaid\n${body.trim()}\n\`\`\`\n`;

/** 13 mermaid diagram types; the flowchart carries HTML labels, a subgraph and an author colour. */
export const MERMAID_GALLERY_DIAGRAMS = [
  `flowchart TD
  subgraph S[Group]
    A["one<br>two"] --> B(Default)
  end
  B --> C{Decide}
  C -->|yes| D[Author colour]
  classDef warm fill:#ffcc00
  class D warm`,
  `sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi`,
  `classDiagram
  Animal <|-- Duck
  Animal : +int age`,
  `stateDiagram-v2
  [*] --> Still
  Still --> Moving
  Moving --> [*]`,
  `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  `gantt
  dateFormat YYYY-MM-DD
  title Plan
  section A
  Task one :a1, 2024-01-01, 3d
  Task two :after a1, 2d`,
  `pie title Pets
  "Dogs" : 40
  "Cats" : 60`,
  `mindmap
  root((Root))
    Branch A
    Branch B`,
  `journey
  title Day
  section Work
    Code: 5: Me
    Review: 3: Me`,
  // Explicit commit ids: default ids are random, which makes the width vary run to run.
  `gitGraph
  commit id: "c1"
  branch dev
  commit id: "c2"
  checkout main
  merge dev id: "m1"`,
  `timeline
  title History
  2020 : Start
  2021 : Growth`,
  `quadrantChart
  title Reach
  x-axis Low --> High
  y-axis Low --> High
  A: [0.3, 0.6]
  B: [0.7, 0.2]`,
  `xychart-beta
  title Sales
  x-axis [jan, feb, mar]
  y-axis "Revenue" 0 --> 100
  bar [20, 50, 80]`,
];

export const MERMAID_GALLERY_MD = `# Gallery\n\n${MERMAID_GALLERY_DIAGRAMS.map(fence).join("\n")}`;

export const TT_ADOC = `= Trusted Types preview
:stem: latexmath

== Section one

Inline math stem:[a^2 + b^2] in a paragraph.

=== Section two

[cols="1,2"]
|===
|Name |Value
|alpha |one
|beta |two
|===

[mermaid]
....
flowchart LR
  X --> Y
....
`;

/** A page whose script comes from a public CDN (agent provenance → restricted egress). */
export const TT_EGRESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>egress</title>
<script src="https://unpkg.com/x.js"></script></head><body><p>egress probe</p></body></html>
`;

export const TT_SAMPLE_TS = `// Trusted Types enforce probe.\nexport const answer: number = 42;\n`;
