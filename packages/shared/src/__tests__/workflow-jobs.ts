/**
 * Line-based slicing of a GitHub Actions workflow into its top-level jobs —
 * shared by the workflow-contract repo-lints so a per-job assertion never
 * falls back to a global count. No YAML dependency: jobs are the 2-space keys
 * under the column-0 `jobs:` line, a job's body runs to the next such key (or
 * the next column-0 line). See change: close-e2e-tooling-followups (D3, D5).
 */

const JOB_KEY = /^ {2}([A-Za-z_][\w-]*):\s*$/;

/** Top-level job ids, in file order. */
export function jobIds(yaml: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const ids: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith("#")) break;
    const m = JOB_KEY.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** The text of job `id` (its key line through the line before the next job), or "" when absent. */
export function jobBlock(yaml: string, id: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return "";
  const header = lines.findIndex((l, i) => i > start && JOB_KEY.exec(l)?.[1] === id);
  if (header === -1) return "";
  const end = lines.findIndex(
    (l, i) => i > header && (JOB_KEY.test(l) || (/^\S/.test(l) && !l.startsWith("#"))),
  );
  return lines.slice(header, end === -1 ? undefined : end).join("\n");
}
