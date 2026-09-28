/**
 * Collapse GitHub's `statusCheckRollup` array into one summary.
 *
 * Shared by the server (`listPullRequests` → `PrCombobox`) and the bridge
 * (`GH_PR_STATUS` → composer / session-card PR segment) so both surfaces
 * classify identically. Entries are discriminated by `__typename`:
 *   - `CheckRun`      → `status` / `conclusion`
 *   - `StatusContext` → `state`
 *
 * Buckets (first match wins across the whole rollup: failing > pending > passing):
 *   - failing: CheckRun conclusion ∈ FAILING_CONCLUSIONS (incl. STALE);
 *              StatusContext state ∈ {FAILURE, ERROR}
 *   - pending: CheckRun still running / no conclusion; StatusContext
 *              state ∈ {PENDING, EXPECTED}; ANY unrecognized value
 *   - passing: everything else present (SUCCESS / NEUTRAL / SKIPPED)
 *   - none:    empty / null rollup
 *
 * See change: redesign-composer-session-strip (D5).
 */
import type { GitPrChecks } from "../types.js";

export interface CheckRollupEntry {
  __typename?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);
const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RUNNING_STATUSES = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

type Bucket = "failing" | "pending" | "passing";

function classifyStatusContext(state: string | undefined): Bucket {
  if (state === "FAILURE" || state === "ERROR") return "failing";
  if (state === "SUCCESS") return "passing";
  return "pending"; // PENDING, EXPECTED, unknown
}

function classifyCheckRun(status: string | undefined, conclusion: string | undefined): Bucket {
  if (conclusion && FAILING_CONCLUSIONS.has(conclusion)) return "failing";
  // Legacy shape (no __typename) carried failure on `status`.
  if (status === "FAILURE" || status === "ERROR") return "failing";
  if (status && RUNNING_STATUSES.has(status)) return "pending";
  if (conclusion && PASSING_CONCLUSIONS.has(conclusion)) return "passing";
  return "pending"; // no conclusion yet, or an unrecognized value
}

function classifyEntry(entry: CheckRollupEntry): Bucket {
  const typename = entry.__typename;
  const isStatusContext =
    typename === "StatusContext" || (typename === undefined && entry.state != null && entry.conclusion == null && entry.status == null);
  if (isStatusContext) return classifyStatusContext(entry.state?.toUpperCase());
  return classifyCheckRun(entry.status?.toUpperCase(), entry.conclusion?.toUpperCase());
}

export function collapseCheckRollup(rollup: readonly CheckRollupEntry[] | null | undefined): GitPrChecks {
  if (!rollup || rollup.length === 0) return "none";
  let pending = false;
  for (const entry of rollup) {
    const bucket = classifyEntry(entry);
    if (bucket === "failing") return "failing";
    if (bucket === "pending") pending = true;
  }
  return pending ? "pending" : "passing";
}
