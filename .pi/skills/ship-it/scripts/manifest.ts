/**
 * Pure helpers for the ship-it / ship-change manifest contract.
 *
 * `test-plan.md` (the scenario manifest, authored by scenario-design) is the
 * single source of truth for automated-vs-manual. These helpers parse it and
 * drive two decisions with NO side effects (unit-testable):
 *   - deferDecision  — which leftover `- [ ]` tasks may be deferred vs. block ship
 *   - filesystemRealityCheck — an automated scenario is done only if its test file exists
 *
 * See OpenSpec change: add-openspec-pipeline-orchestrators (D2, D3, D4).
 */

export type Disposition = "automated" | "manual-only";

export interface ManifestRow {
  id: string;
  level: string;
  disposition: Disposition;
}

const DISPOSITIONS = new Set<Disposition>(["automated", "manual-only"]);

/** Split a markdown table row `| a | b |` into trimmed cells. */
function splitCells(line: string): string[] {
  const trimmed = line.trim();
  // Drop the leading/trailing pipe, then split. Keeps empty interior cells.
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableRow = (line: string): boolean => line.trim().startsWith("|");
const isSeparatorRow = (line: string): boolean =>
  /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

type ColMap = { id: number; level: number; disposition: number };

/** A header row (has both `id` and `disposition` cells) yields a column map. */
function headerMap(cells: string[]): ColMap | null {
  const lower = cells.map((c) => c.toLowerCase());
  const id = lower.indexOf("id");
  const disposition = lower.indexOf("disposition");
  if (id === -1 || disposition === -1) return null;
  return { id, level: lower.indexOf("level"), disposition };
}

/** A data row under a known column map yields a scenario, or null if malformed. */
function dataRow(cells: string[], map: ColMap): ManifestRow | null {
  const id = cells[map.id] ?? "";
  const disposition = cells[map.disposition] ?? "";
  const level = map.level >= 0 ? (cells[map.level] ?? "") : "";
  if (!id || id.toLowerCase() === "id") return null;
  if (!DISPOSITIONS.has(disposition as Disposition)) return null;
  return { id, level, disposition: disposition as Disposition };
}

/**
 * Parse `test-plan.md` markdown tables into scenario rows.
 *
 * Tolerant by design: multiple tables (one per scenario class) each carry their
 * own header; column order can differ. A header line that contains both an `id`
 * and a `disposition` cell activates a column mapping for the rows beneath it.
 * Rows are skipped when they are separators, header echoes, have no id, or carry
 * a disposition that is not exactly `automated` / `manual-only`.
 */
export function parseManifest(text: string): ManifestRow[] {
  const rows: ManifestRow[] = [];
  if (!text) return rows;

  let map: ColMap | null = null;

  for (const line of text.split("\n")) {
    if (!isTableRow(line)) {
      map = null; // any non-table line ends the current table
      continue;
    }
    if (isSeparatorRow(line)) continue;

    const cells = splitCells(line);
    const header = headerMap(cells);
    if (header) {
      map = header; // defines the column mapping for the rows that follow
      continue;
    }
    if (!map) continue; // data row with no known header (e.g. no disposition col)

    const row = dataRow(cells, map);
    if (row) rows.push(row);
  }
  return rows;
}

const LEGACY_DEFER_RE = /\b(qa|manual|verify|smoke|e2e|acceptance|test by hand)\b/i;

/**
 * Determine a leftover task's disposition from its text + the manifest map.
 * Recognizes an inline `(test-plan: automated|manual-only)` tag or a
 * `(test-plan #<id>)` reference resolved against the manifest.
 * Returns `"unknown"` when neither signal is present.
 */
export function classifyTaskDisposition(
  task: string,
  manifestById: Map<string, Disposition>,
): Disposition | "unknown" {
  const inline = task.match(/test-plan:\s*(automated|manual-only)/i);
  if (inline) return inline[1].toLowerCase() as Disposition;

  const ref = task.match(/test-plan[:\s]*#\s*([A-Za-z]*\d+)/i);
  if (ref) {
    const found = manifestById.get(ref[1]);
    if (found) return found;
  }
  return "unknown";
}

export interface DeferResult {
  action: "defer" | "stop";
  deferred: string[];
  blockers: string[];
  reason: string;
}

/**
 * Decide whether leftover `- [ ]` tasks may be deferred (manifest-aware) or
 * whether real work remains and the ship must stop.
 *
 * - manifest present: a leftover is deferrable ONLY if it maps to a `manual-only`
 *   manifest row (via inline tag or id reference). Anything else blocks.
 * - manifest absent (legacy change): fall back to the historical keyword defer,
 *   preserved verbatim.
 */
export function deferDecision(
  tasks: string[],
  manifestText: string | null,
): DeferResult {
  const deferred: string[] = [];
  const blockers: string[] = [];

  if (manifestText != null) {
    const byId = new Map<string, Disposition>(
      parseManifest(manifestText).map((r) => [r.id, r.disposition]),
    );
    for (const task of tasks) {
      if (classifyTaskDisposition(task, byId) === "manual-only") deferred.push(task);
      else blockers.push(task);
    }
    return blockers.length > 0
      ? { action: "stop", deferred, blockers, reason: "non-manual leftover(s) remain" }
      : { action: "defer", deferred, blockers, reason: "all leftovers are manual-only" };
  }

  // Legacy path — no manifest: keyword defer, unchanged.
  for (const task of tasks) {
    if (LEGACY_DEFER_RE.test(task)) deferred.push(task);
    else blockers.push(task);
  }
  return blockers.length > 0
    ? { action: "stop", deferred, blockers, reason: "non-QA/manual leftover(s) remain (legacy keyword rule)" }
    : { action: "defer", deferred, blockers, reason: "all leftovers match the legacy QA/manual keywords" };
}

export interface ScenarioFile {
  id: string;
  disposition: Disposition;
  testFile: string;
}

/**
 * Filesystem-reality gate (D4): an `automated` scenario counts as satisfied only
 * when its test file actually exists — the `tasks.md` checkbox is not trusted.
 * `manual-only` scenarios are never gated on a file (they are deferred).
 */
export function filesystemRealityCheck(
  scenarios: ScenarioFile[],
  exists: (p: string) => boolean,
): { satisfied: ScenarioFile[]; unsatisfied: ScenarioFile[] } {
  const satisfied: ScenarioFile[] = [];
  const unsatisfied: ScenarioFile[] = [];
  for (const s of scenarios) {
    if (s.disposition === "automated" && !exists(s.testFile)) unsatisfied.push(s);
    else satisfied.push(s);
  }
  return { satisfied, unsatisfied };
}
