import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function extractProjectDir(cwd: string, id: string): string {
  const segments = cwd.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : id.slice(0, 8);
}

export function buildDocumentTitle(
  session: DashboardSession | undefined,
  folderCwd?: string,
): string {
  if (session) {
    const dir = extractProjectDir(session.cwd, session.id);

    if (session.name && session.name.trim()) {
      const name = session.name.trim();
      if (name.toLowerCase() === dir.toLowerCase()) {
        return `${name} — PI Dashboard`;
      }
      return `${name} (${dir}) — PI Dashboard`;
    }

    return `${dir} — PI Dashboard`;
  }

  if (folderCwd) {
    return `${extractProjectDir(folderCwd, "")} — PI Dashboard`;
  }

  return "PI Dashboard";
}
