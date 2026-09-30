/**
 * Affected-test selection — the pure decision function.
 *
 * Input is a precomputed test index (see graph.mjs) plus the changed-file list
 * (see git-diff.mjs). No I/O happens here, so every layer is unit-testable over
 * a synthetic index. Layer order and precedence: design D2 of change
 * speed-up-ci-affected-tests.
 *
 *   full   ← forced (dispatch / ci:full) | global input | unmapped outside file
 *   affected = graph ∪ open-edge ∪ always-run ∪ path-literal ∪ package fallback
 *              ∪ trigger map  − slow tier unless edited (applied last, logged)
 *
 * Deselection happens for exactly two reasons: the graph proves a test
 * unaffected, or the file is on the slow-tier manifest. Every other kind of
 * uncertainty widens the selection.
 */

/** Unit shards in ci.yml / nightly-tests.yml. The matrix length must equal this. */
export const SHARD_COUNT = 4;

/** Layer names in precedence order. The first layer to select a file is recorded. */
export const LAYERS = ["graph", "open-edge", "always", "path-literal", "package-fallback", "trigger-map"];

const COUNT_KEY = {
  graph: "graph",
  "open-edge": "openEdge",
  always: "always",
  "path-literal": "pathLiteral",
  "package-fallback": "packageFallback",
  "trigger-map": "triggerMap",
};

const TIMINGS_FILE = "scripts/test-selection/timings.json";

/** Static global inputs: any change here → full. setupFiles/globalSetup come from the configs. */
export function isGlobalInput(file) {
  if (file === "pnpm-lock.yaml" || file === "package.json") return true;
  // Any vitest config, the shared worker-target module, the real-process file list.
  if (/(^|\/)vitest\.[^/]+\.(?:[cm]?[jt]s)$/.test(file)) return true;
  if (/(^|\/)tsconfig[^/]*\.json$/.test(file)) return true;
  // The selector and the data files that decide selection — but not the timings.
  if (file === "scripts/select-affected-tests.mjs") return true;
  if (file.startsWith("scripts/test-selection/") && file !== TIMINGS_FILE) return true;
  return false;
}

/** The location a path lives in: `packages/<p>` under packages/, else its top-level entry. */
export function locationOf(file) {
  const parts = file.split("/");
  if (parts[0] === "packages" && parts.length > 2) return `packages/${parts[1]}`;
  return parts[0];
}

/** A test file that READS the packaging-scenarios env var (a mention in prose does not count). */
export function isGatedSource(source) {
  return /process\.env\.RUN_CI_SCENARIOS\b|process\.env\[\s*["'`]RUN_CI_SCENARIOS["'`]\s*\]/.test(source);
}

const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/**
 * Locations a test source names by string literal: a literal equal to a
 * top-level entry, or beginning `<entry>/`. Under `packages/` the literal
 * `packages/<p>/…` names the package; a bare `packages` names every package.
 * Leading `./` and `../` segments are stripped, so a relative reach from a
 * test's own directory still counts. A heuristic that only ever ADDS tests.
 */
export function extractLocations(source, topLevel) {
  const top = new Set(topLevel);
  const out = new Set();
  for (const m of source.matchAll(STRING_RE)) {
    let lit = m[2];
    if (m[1] === "`") lit = lit.split("${")[0];
    lit = lit.replace(/^(?:\.\.?\/)+/, "");
    if (!lit) continue;
    const parts = lit.split("/");
    if (!top.has(parts[0])) continue;
    if (parts[0] === "packages" && parts.length > 1 && parts[1]) out.add(`packages/${parts[1]}`);
    else out.add(parts[0]);
  }
  return [...out].sort();
}

/** Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one char. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const within = (file, loc) => file === loc || file.startsWith(`${loc}/`);

function median(values) {
  if (values.length === 0) return 1;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Greedy longest-processing-time assignment. Deterministic: files sorted by
 * weight desc then path asc; each goes to the least-loaded shard, ties to the
 * lowest index. Unknown files weigh the median of the known timings.
 */
export function assignShards(files, timings, shardCount = SHARD_COUNT) {
  const med = median(Object.values(timings));
  const weights = {};
  let unknown = 0;
  for (const f of files) {
    if (typeof timings[f] === "number") weights[f] = timings[f];
    else {
      weights[f] = med;
      unknown++;
    }
  }
  const order = [...files].sort((a, b) => weights[b] - weights[a] || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: shardCount }, () => []);
  const loads = Array(shardCount).fill(0);
  for (const f of order) {
    let best = 0;
    for (let i = 1; i < shardCount; i++) if (loads[i] < loads[best]) best = i;
    shards[best].push(f);
    loads[best] += weights[f];
  }
  for (const s of shards) s.sort();
  return {
    shards,
    loads: loads.map((l) => Math.round(l * 1000) / 1000),
    weights,
    unknownTimingShare: files.length ? unknown / files.length : 0,
  };
}

/**
 * @param {object} input
 * @param {string[]} input.changed          repo-relative changed paths (no rename detection)
 * @param {string|null} input.forceFull     reason when the run is forced full (dispatch, ci:full, error)
 * @param {object} input.index              { tests, openModules, globalInputs, leafErrors }
 *   tests[path] = { deps: string[], phase: "parallel"|"real-process", locations: string[], gated: boolean }
 * @param {object} input.data               { triggers, coveredElsewhere, slowTier }
 * @param {Record<string, number>} input.timings
 * @param {number} [input.shardCount]
 */
export function decide({ changed, forceFull = null, index, data, timings = {}, shardCount = SHARD_COUNT }) {
  const tests = index.tests;
  const allTests = Object.keys(tests).sort();
  const changedSet = new Set(changed);
  const globalInputs = new Set(index.globalInputs ?? []);
  const slowTier = new Set(data.slowTier ?? []);
  const openModules = new Set(index.openModules ?? []);

  let fullReason = forceFull;
  const globalHits = changed.filter((f) => isGlobalInput(f) || globalInputs.has(f));
  if (!fullReason && globalHits.length) fullReason = `global input changed: ${globalHits.join(", ")}`;

  const reached = new Set();
  for (const t of allTests) for (const d of tests[t].deps) reached.add(d);

  const selected = {};
  const add = (file, layer) => {
    if (!(file in selected)) selected[file] = layer;
  };
  const unmapped = [];

  if (!fullReason) {
    // Layer: graph — the test itself, or any module it reaches, changed.
    for (const t of allTests) {
      if (changedSet.has(t) || tests[t].deps.some((d) => changedSet.has(d))) add(t, "graph");
    }
    // Layer: open edge — the test, or a module it reaches, holds a computed
    // import(): any change in that module's location selects the test.
    const changedLocs = new Set(changed.map(locationOf));
    for (const t of allTests) {
      if ([t, ...tests[t].deps].some((d) => openModules.has(d) && changedLocs.has(locationOf(d)))) add(t, "open-edge");
    }
    // Layer: always-run — tests with no local deps run on every diff.
    for (const t of allTests) if (tests[t].deps.length === 0) add(t, "always");
    // Layer: path literal — a test naming a location that holds a changed file.
    for (const t of allTests) {
      const locs = tests[t].locations ?? [];
      if (locs.some((loc) => changed.some((f) => within(f, loc)))) add(t, "path-literal");
    }
    // Unreached, non-test changes: package fallback inside packages/, data files outside.
    const covered = data.coveredElsewhere ?? [];
    const triggers = Object.entries(data.triggers ?? {}).map(([g, testGlobs]) => [globToRegExp(g), testGlobs.map(globToRegExp)]);
    for (const f of changed) {
      if (reached.has(f) || f in tests || f === TIMINGS_FILE) continue;
      const parts = f.split("/");
      if (parts[0] === "packages" && parts.length > 2) {
        const pkg = `packages/${parts[1]}`;
        for (const t of allTests) {
          if (within(t, pkg) || tests[t].deps.some((d) => within(d, pkg))) add(t, "package-fallback");
        }
        continue;
      }
      const hits = triggers.filter(([re]) => re.test(f));
      if (hits.length) {
        for (const [, testRes] of hits) for (const t of allTests) if (testRes.some((re) => re.test(t))) add(t, "trigger-map");
        continue;
      }
      if (covered.includes(parts[0])) continue;
      unmapped.push(f);
    }
    if (unmapped.length) fullReason = `unmapped file outside packages/: ${unmapped.join(", ")}`;
  }

  const mode = fullReason ? "full" : "affected";
  const slowTierDeselected = [];
  if (mode === "full") {
    for (const k of Object.keys(selected)) delete selected[k];
    for (const t of allTests) selected[t] = "full";
  } else {
    // Slow tier: applied LAST, over every layer; re-included only when edited.
    for (const t of Object.keys(selected).sort()) {
      if (slowTier.has(t) && !changedSet.has(t)) {
        delete selected[t];
        slowTierDeselected.push(t);
      }
    }
  }

  const ciScenarios = mode === "full" || (changed.length > 0 && !changed.every((f) => f.startsWith("openspec/")));
  const gatedAll = allTests.filter((t) => tests[t].gated);
  const sel = Object.keys(selected).sort();
  const realProcess = sel.filter((t) => tests[t].phase === "real-process" && !tests[t].gated);
  const parallel = sel.filter((t) => tests[t].phase !== "real-process" && !tests[t].gated);
  const shardResult = assignShards(parallel, timings, shardCount);

  const counts = { global: globalHits.length };
  for (const layer of LAYERS) counts[COUNT_KEY[layer]] = 0;
  for (const layer of Object.values(selected)) if (COUNT_KEY[layer]) counts[COUNT_KEY[layer]]++;
  counts.slowTierDeselected = slowTierDeselected.length;

  const sortedSelected = {};
  for (const t of sel) sortedSelected[t] = selected[t];

  return {
    mode,
    reason: fullReason ?? `affected: ${changed.length} changed file(s)`,
    changed: [...changed].sort(),
    selected: sortedSelected,
    shards: shardResult.shards,
    shardLoads: shardResult.loads,
    realProcess,
    ciScenarios,
    ciScenariosFiles: ciScenarios ? gatedAll : [],
    counts,
    unmapped,
    leafErrors: index.leafErrors ?? [],
    openEdges: [...openModules].filter((m) => reached.has(m) || m in tests).sort(),
    slowTierDeselected,
    unknownTimingShare: shardResult.unknownTimingShare,
  };
}
