/**
 * Regenerates this fixture's `deck.md` (Section 20 FX-coverage pass).
 *
 * The 23 narrative slides are LIFTED VERBATIM from
 * `presentations/business-next-5-years/deck.md` — the fixture must not drift
 * from the deck it is cut from. The remaining slides exist so every card in
 * the corpus is presented somewhere; their copy is deliberately qualitative
 * (checklists and questions), because inventing sourced-looking statistics in
 * a deck whose whole point is "sourced and dated" would be a lie in a fixture.
 *
 *   node build-deck.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, "..", "..", "..", "..", "presentations", "business-next-5-years", "deck.md");

const FRONTMATTER = `---
mode: dark
palette: blackbelt
material: glass
quality: high
---
`;

const CAM = `<!-- deck3d: {"camera":{"distance":12},"check":{"ignore":["contrast"]}} -->`;

/** Slides authored for this fixture — one per corpus card left uncovered. */
const EXTRA = [
  ["procurement", "Procurement Learns AI", "The buying committee grew a new seat", ["An AI reviewer now reads your answers", "Questionnaires ask for model provenance", "Expect data-residency clauses by default", "Answer once, reuse the artefact"]],
  ["proof-library", "Build a Proof Library", "Stop rebuilding evidence per deal", ["One benchmark, run on the buyer's shape of data", "A reference that survives a reference call", "A failure you can describe honestly", "Version it like product, not like slides"]],
  ["pricing", "Pricing Moves to Outcomes", "Seats price the tool, not the result", ["Per-seat erodes when the seat is an agent", "Usage pricing exposes your cost floor", "Outcome pricing needs measurement you trust", "Pick the unit you can defend in a QBR"]],
  ["dataroom", "Your Data Room Is the Demo", "Buyers inspect the plumbing now", ["Where the data sits, and who can reach it", "What is retained, and for how long", "Which subprocessor sees what", "Have the diagram ready before they ask"]],
  ["energy", "Energy Becomes a Sales Term", "Compute has a physical bill", ["Capacity is booked years ahead", "Locality changes latency and price", "Efficiency turns into a commercial argument", "Know what your workload actually costs"]],
  ["sovereignty", "Sovereign by Default", "Where it runs is part of the product", ["Region is a requirement, not a preference", "Public sector leads, enterprise follows", "Portability beats promises of portability", "Design for a split deployment early"]],
  ["identity", "Agents Need Identity", "A non-human actor still needs a name", ["Credentials scoped per agent, not per team", "Every action attributable after the fact", "Revocation that works in minutes", "Least privilege survives the pilot"]],
  ["security", "The New Attack Surface", "Prompt paths are input paths", ["Untrusted text reaching a tool call", "Retrieval as an injection channel", "Agent output treated as trusted input", "Red-team the loop, not just the model"]],
  ["integration", "The Integration Tax", "The demo is not the deployment", ["Legacy systems set the real timeline", "Data quality sets the real accuracy", "Change management sets the real adoption", "Quote the tax, or absorb it later"]],
  ["evals", "Evaluation Becomes a Product", "If you cannot measure it, you cannot renew it", ["A shared definition of good, written down", "Regression runs before every release", "Buyer-visible dashboards, not screenshots", "Evaluation is the contract's spine"]],
  ["support", "Support Is the Beachhead", "The first place agents actually land", ["Volume, repetition and written history", "Deflection is measurable on day one", "Escalation design decides the outcome", "Win here, expand from evidence"]],
  ["talent", "The Talent Market Splits", "Two curves, moving apart", ["Deep specialists become scarcer", "Generalists gain reach, then get squeezed", "Hiring bars move mid-process", "Skills currency beats a title"]],
  ["partners", "Partners Change Shape", "Integrators sell outcomes, not bodies", ["Day-rate models lose their basis", "Reference architectures become products", "Co-selling needs shared proof", "Pick partners by evidence, not logo"]],
  ["smb", "The Long Tail Wakes Up", "Capability arrives without a project", ["Defaults do the adoption for them", "Willingness to pay stays thin", "Distribution beats feature depth", "Self-serve proof or no proof"]],
  ["metrics", "What the Board Will Ask", "Four questions, every quarter", ["What did it cost, all-in", "What changed that we can measure", "What is the exposure if it is wrong", "What happens if we stop"]],
  ["risks", "Risk Register 2031", "Name them before a buyer does", ["Concentration in one supply chain", "Regulatory divergence across regions", "Model behaviour drifting under you", "Organisational trust spent too early"]],
  ["close", "The Bet", "Depth, evidence, and the patience to measure", ["Broad adoption is already priced in", "Depth is where the next five years pay", "Proof compounds; narrative does not", "Start with one account, this quarter"]],
];

const narrative = readFileSync(SOURCE, "utf8")
  .replace(/^---[\s\S]*?---\n/, "")
  .split(/\n(?=# )/)
  .map((s) => s.trim())
  .filter(Boolean);

const extras = EXTRA.map(([id, title, sub, bullets]) => `# ${title} {#${id}}\n\n${sub}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n\n${CAM}`);

writeFileSync(join(here, "deck.md"), `${FRONTMATTER}\n${[...narrative, ...extras].join("\n\n")}\n`);
console.log(`deck.md: ${narrative.length} narrative + ${extras.length} authored = ${narrative.length + extras.length} slides`);
