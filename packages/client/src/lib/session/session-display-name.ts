import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Get display name for a session: name → firstMessage (truncated) → cwd last segment → ID prefix */
export function getSessionDisplayName(session: DashboardSession): string {
  if (session.name && session.name.trim()) {
    return session.name.trim();
  }
  if (session.firstMessage && session.firstMessage.trim()) {
    const msg = session.firstMessage.trim();
    return msg.length > 50 ? msg.slice(0, 50) + "..." : msg;
  }
  return session.cwd.split("/").pop() || session.id.slice(0, 8);
}
