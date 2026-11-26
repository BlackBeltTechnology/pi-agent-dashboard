/**
 * Member folder display (design D14): `.` when equal to the lead's folder, a path
 * relative to it when inside, the absolute path otherwise. Separators are
 * normalised, trailing separators ignored, and a Windows drive letter compares
 * case-insensitively; the match is on whole path segments (`/ws/lead-other` is NOT
 * inside `/ws/lead`). Pure, no React.
 * See change: add-agent-teams-ui.
 */

function normalise(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) p = p.charAt(0).toLowerCase() + p.slice(1);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export function formatCwd(cwd: string, leadCwd: string): string {
  const c = normalise(cwd);
  const lead = normalise(leadCwd);
  if (c === lead) return ".";
  const prefix = lead.endsWith("/") ? lead : `${lead}/`;
  return c.startsWith(prefix) ? c.slice(prefix.length) : cwd;
}
