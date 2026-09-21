/**
 * Regenerates `overrides.json` (Section 20 FX-coverage pass) and asserts the
 * coverage claim the fixture exists to make: EVERY card in the corpus appears
 * on exactly one slide, and no card appears twice.
 *
 * Deck-scope effects are deliberately EMPTY — `applyOverrides` prepends them
 * to every slide, which is duplication by construction.
 *
 *   node build-overrides.mjs && ../../bin/deck3d overrides apply deck.json overrides.json
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** slide id → the cards it presents. One card, one slide, deck-wide. */
const PLAN = {
  "how-business-changes-by-2031": ["local:closing-mark", "vignette"],
  why: ["grid-horizon", "fog"],
  forces: ["neural-mesh", "glass", "signal-pulse"],
  capability: ["curve-flow", "bloom"],
  jagged: ["tessellate", "sobel"],
  adoption: ["data-columns", "smaa", "fade"],
  agentgap: ["agent-depth", "float"],
  money: ["capital-flows", "film"],
  trust: ["trust-ledger", "glow-tube"],
  dealflow: ["proof-gate", "depth-of-field", "particle-stream"],
  work: ["cohort-grid", "outline"],
  skills: ["swarm", "accent-cycle"],
  reskill: ["points-on-geometry", "matcap"],
  entry: ["sprites", "stagger-reveal"],
  geo: ["geo-fragments", "lightformers", "dolly"],
  compute: ["fab-wafer", "god-rays"],
  productivity: ["market-tape", "selective-bloom"],
  model: ["extruded-shapes", "iridescent"],
  sales: ["orbit-agents", "chromatic-aberration"],
  timeline: ["rings", "room-ibl"],
  monday: ["hex-grid", "metal", "dashed-flow"],
  wrong: ["glyph-rain", "ascii"],
  sources: ["paper-stack", "camera-drift"],
  procurement: ["vault-glyphs", "soft-shadows"],
  "proof-library": ["billboards", "emissive"],
  pricing: ["tokens", "trail"],
  dataroom: ["server-racks", "orbit"],
  energy: ["volume-cloud", "sao"],
  sovereignty: ["globe-arcs", "volumetric-spot"],
  identity: ["constellation", "holo-fresnel"],
  security: ["scatter", "dot-screen"],
  integration: ["clipped-solids", "wireframe-overlay"],
  evals: ["dynamic-instances", "iris"],
  support: ["shader-particles", "mirror-floor"],
  talent: ["city-grid", "flythrough"],
  partners: ["starfield"],
  smb: ["particles", "pixelate"],
  metrics: ["volume-perlin"],
  risks: ["aurora"],
  close: ["horizon-gates"],
};

/**
 * Built topologies. The narrative rows are LIFTED from
 * `presentations/business-next-5-years/deck.json` — auto-derivation feeds raw
 * bullet text into the node labels, which overlaps past the IoU gate; the
 * curated short labels are what makes `check` clean. Authored slides follow
 * the same rule: <= ~14 characters per node.
 */
const DIAGRAMS = {
  why: { kind: "stack", data: { labels: ["Buyers changed", "Proof beats promise", "Sourced + dated"] } },
  forces: { scale: 1 },
  capability: { kind: "bars", data: { labels: ["SWE-bench", "Science", "Agents", "US\u2013CN"], values: [100, 88, 66, 4] } },
  jagged: { kind: "bars", data: { labels: ["IMO", "Clocks", "Tasks", "Spike"], values: [100, 50, 67, 30] } },
  adoption: { kind: "bars", data: { labels: ["Orgs", "Function", "People", "Students"], values: [88, 70, 53, 80] } },
  agentgap: { kind: "orbit-cluster", data: { labels: ["Bought AI", "Piloting", "In production", "At depth"] } },
  money: { kind: "bars", data: { labels: ["Private", "Corporate", "Capex", "Free"], values: [285.9, 200, 150, 172] } },
  trust: { kind: "funnel", data: { labels: ["Ambition", "Evidence demanded", "Governance", "Measured value"] } },
  dealflow: { scale: 1.3 },
  work: { kind: "bars", data: { labels: ["Churn", "Created", "Displaced", "Net"], values: [22, 170, 92, 78] } },
  skills: { kind: "orbit-cluster", data: { labels: ["AI + data", "Cybersecurity", "Analytical", "Creative"] } },
  reskill: { kind: "bars", data: { labels: ["Training", "Upskilled", "Redeployed", "Nothing"], values: [59, 29, 19, 11] } },
  entry: { kind: "bars", data: { labels: ["Devs 22\u201325", "Exposed", "Cuts"], values: [20, 33, 33] } },
  geo: { kind: "globe", data: { labels: ["Geoeconomics", "Model change", "Fragmented order", "Sovereignty"] } },
  compute: { kind: "stack", data: { labels: ["Data centres", "One foundry", "Energy + capex", "Latency terms"] } },
  productivity: { kind: "bars", data: { labels: ["Support", "Dev", "Marketing", "Reasoning"], values: [15, 26, 50, 5] } },
  model: { scale: 1.3 },
  sales: { kind: "funnel", data: { labels: ["Benchmarks", "Governance", "Agent gap", "Reskilling", "Trust"] } },
  timeline: { scale: 0.95 },
  monday: { kind: "loop", data: { labels: ["Audit accounts", "Swap in proof", "Name governance", "Book reskilling"] } },
  wrong: { kind: "funnel", data: { labels: ["Downturn", "Regulation", "Plateau", "Trust collapse"] } },
  sources: { kind: "timeline-rail", data: { labels: ["WEF Jobs 25", "HAI Index 26", "Global Risks 26", "Entry-Level 26", "Forrester 26"] } },
  procurement: { kind: "funnel", data: { labels: ["Questionnaire", "Provenance", "Residency", "Reuse"] } },
  "proof-library": { kind: "stack", data: { labels: ["Benchmark", "Reference", "Honest miss", "Versioned"] } },
  pricing: { kind: "bars", data: { labels: ["Per-seat", "Usage", "Outcome", "Defensible"], values: [30, 55, 80, 95] } },
  dataroom: { kind: "orbit-cluster", data: { labels: ["Location", "Retention", "Subprocessors", "Diagram"] } },
  energy: { kind: "bars", data: { labels: ["Capacity", "Locality", "Efficiency", "Cost"], values: [80, 60, 45, 70] } },
  sovereignty: { kind: "globe", data: { labels: ["Region", "Public first", "Portability", "Split deploy"] } },
  identity: { kind: "brain", data: { labels: ["Scoped creds", "Attribution", "Revocation", "Least privilege"] } },
  security: { kind: "swarm", data: { labels: ["Prompt path", "Retrieval", "Agent output", "Red team"] } },
  integration: { kind: "timeline-rail", data: { labels: ["Legacy", "Data quality", "Change mgmt", "The tax"] } },
  evals: { kind: "loop", data: { labels: ["Define good", "Regression", "Dashboards", "Renewal"] } },
  support: { kind: "funnel", data: { labels: ["Volume", "Deflection", "Escalation", "Expansion"] } },
  talent: { kind: "bars", data: { labels: ["Specialists", "Generalists", "Hiring bar", "Skills"], values: [40, 70, 55, 85] } },
  partners: { kind: "orbit-cluster", data: { labels: ["Day rate", "Ref arch", "Co-sell", "Evidence"] } },
  smb: { kind: "stack", data: { labels: ["Defaults", "Thin WTP", "Distribution", "Self-serve"] } },
  metrics: { kind: "funnel", data: { labels: ["Cost", "Change", "Exposure", "Stop test"] } },
  risks: { kind: "timeline-rail", data: { labels: ["Supply chain", "Regulation", "Drift", "Trust"] } },
  close: { kind: "loop", data: { labels: ["Depth", "Evidence", "Measure", "One account"] } },
};

/** Tuning kept from the previous pass — the values reviewed on screen. */
const PARAMS = {
  "geo-fragments": { activity: 0.75, breathe: 1, spin: 1.2 },
  "fab-wafer": { wave: 2, waveSpeed: 3, density: 3 },
  "hex-grid": { scale: 4 },
  "paper-stack": { density: 3, speed: 3 },
  "signal-pulse": { intensity: 0.85 },
  "proof-gate": { density: 0.2 },
};

const fxDir = join(here, "..", "..", "src", "fx");
const known = new Set(
  readdirSync(fxDir)
    .filter((f) => f.endsWith(".meta.json"))
    .map((f) => JSON.parse(readFileSync(join(fxDir, f), "utf8")).id),
);

const planned = Object.values(PLAN).flat();
const dupes = planned.filter((id, i) => planned.indexOf(id) !== i);
if (dupes.length) throw new Error(`card used on more than one slide: ${[...new Set(dupes)].join(", ")}`);
const uncovered = [...known].filter((id) => !planned.includes(id));
if (uncovered.length) throw new Error(`corpus card never presented: ${uncovered.join(", ")}`);
const unknown = planned.filter((id) => !known.has(id) && !id.startsWith("local:"));
if (unknown.length) throw new Error(`unknown card: ${unknown.join(", ")}`);

const slides = {};
for (const [slide, ids] of Object.entries(PLAN)) {
  const effects = ids.map((id) => {
    const ref = { id };
    if (PARAMS[id]) ref.params = PARAMS[id];
    if (id.startsWith("local:")) {
      const file = join(here, "fx", `${id.slice("local:".length)}.js`);
      ref.sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
    return ref;
  });
  slides[slide] = DIAGRAMS[slide] ? { effects, diagram: DIAGRAMS[slide] } : { effects };
}

writeFileSync(
  join(here, "overrides.json"),
  `${JSON.stringify({ deck: { palette: "blackbelt", floor: "water", rail: "tunnel", titleEdge: "contrast" }, effects: [], slides }, null, 2)}\n`,
);
console.log(`overrides.json: ${Object.keys(PLAN).length} slides, ${planned.length} card placements, ${known.size} corpus cards covered`);
