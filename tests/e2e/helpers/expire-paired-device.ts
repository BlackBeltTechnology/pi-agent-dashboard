/**
 * Seed helper: make a paired browser device's bearer EXPIRED on the harness.
 *
 * There is deliberately no clock-offset flag on the server (it would be a
 * prod-reachable seam), so the only way to observe the distinct 401
 * `bearer_expired` answer in a browser is to age the REGISTRY ROW: pair a real
 * `holder:"browser"` device (so the stored hashes are real), then rewrite that
 * row's `expiresAt` into the past inside the container (`docker exec`, as
 * `container-proc.ts` does) and restart the server process so its in-memory
 * registry reloads. The `pi-state` tmpfs survives a server restart (not a
 * container restart), so the edit persists for the spec.
 *
 * Rows are addressed by LABEL (`pairDeviceBearer`/`pairBrowserBearer`'s
 * `label` option), never by id or token — no secret is read or written.
 *
 * See change: harden-auth-credentials (D5; test-plan #AF4).
 */
import { execFileSync } from "node:child_process";
import { resolveContainer } from "./container-proc.js";
import { restartDashboard } from "./windowed-session.js";

const REGISTRY = "/home/pi/.pi/dashboard/paired-devices.json";

/**
 * Set `expiresAt` of every row labelled `label` (a re-run on a kept harness leaves earlier rows) to one minute ago (keeping `pairedAt`) and restart
 * the server. Throws when no row carries that label.
 */
export async function expirePairedDevice(label: string): Promise<void> {
  const script = `
    const fs = require("node:fs");
    const [file, label, at] = process.argv.slice(1);
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const matching = rows.filter((r) => r.label === label);
    if (matching.length === 0) { console.error("no paired device labelled " + label); process.exit(3); }
    for (const row of matching) row.expiresAt = Number(at);
    fs.writeFileSync(file, JSON.stringify(rows), { mode: 0o600 });
  `;
  execFileSync(
    "docker",
    ["exec", resolveContainer(), "node", "-e", script, REGISTRY, label, String(Date.now() - 60_000)],
    { encoding: "utf8", timeout: 30_000 },
  );
  await restartDashboard();
}
