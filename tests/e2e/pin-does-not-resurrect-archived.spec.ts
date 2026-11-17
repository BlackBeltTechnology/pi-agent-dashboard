/**
 * L3 — pinning a folder must not resurrect its archived sessions
 * (fix-discovery-resurrects-archived, test-plan #F4).
 *
 * Why L3: the bug was a split brain only the full stack shows — the boot scan
 * indexes `archived:true` sidecars (the fold still counts them) while the
 * pin's on-demand `.jsonl` discovery re-inserted the same ids into the live
 * set and rewrote their sidecars. Here both halves are observed: the fold
 * count, the live `/api/sessions` set, and the archive listing.
 *
 * Exemplar: `tests/e2e/archive-fold.spec.ts` — sidecars seeded out-of-band via
 * `docker exec`, `POST /api/restart` so the boot scan indexes them, then pin
 * AFTER the restart (a pin sent just before a restart can be lost). The pin is
 * the browser bus `pin_directory` message, the same one the pin dialog sends
 * (the dialog's commit is disabled for an already-pinned path, so the bus is
 * the idempotent driver). A resident ended session keeps the folder a non-stub
 * group, which is what renders the archive fold.
 *
 * See change: fix-discovery-resurrects-archived.
 */
import crypto from "node:crypto";
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { inContainer, pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { restartDashboard } from "./helpers/windowed-session.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const CWD = "/root/proj-x";
const HOUR = 60 * 60 * 1000;
/** Header field every seeded transcript carries (cleanup selector). */
const MARKER = "e2ePinNoResurrect";
/** pi's on-disk encoding of a cwd into a sessions subdirectory name. */
const SESSIONS_REL = `.pi/agent/sessions/--${CWD.replace(/^\//, "").replace(/\//g, "-")}--`;

/** Run a node snippet in the container (base64-staged so any quoting is safe). */
function runNode(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return inContainer(`node -e 'eval(Buffer.from("${b64}","base64").toString("utf8"))'`).trim();
}

/**
 * Plant a `<stamp>_<uuid>.jsonl` + `.meta.json` pair in the folder's sessions
 * dir; `archived: null` plants the transcript only (no sidecar).
 */
function seedSession(archived: boolean | null, endedAt: number): string {
  const id = crypto.randomUUID();
  const startedAt = endedAt - HOUR;
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const header = { type: "session", id, cwd: CWD, timestamp: new Date(startedAt).toISOString(), [MARKER]: true };
  const meta: Record<string, unknown> = { cwd: CWD, status: "ended", name: `e2e-pinres-${id.slice(0, 8)}`, startedAt, endedAt };
  if (archived) Object.assign(meta, { archived: true, archivedAt: endedAt });
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const d=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
      `fs.mkdirSync(d,{recursive:true});` +
      `fs.writeFileSync(p.join(d,${JSON.stringify(`${stamp}_${id}.jsonl`)}),${JSON.stringify(`${JSON.stringify(header)}\n`)});` +
      (archived === null
        ? ""
        : `fs.writeFileSync(p.join(d,${JSON.stringify(`${stamp}_${id}.meta.json`)}),${JSON.stringify(JSON.stringify(meta))});`),
  );
  return id;
}

/**
 * Delete only this spec's seeds: every `.jsonl` whose header carries MARKER,
 * plus its sidecar. Marker-based (not a tracked list) so a crashed run heals
 * on the next entry, and other history in the folder is never touched.
 */
function cleanup(): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const d=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
      `if(!fs.existsSync(d))process.exit(0);` +
      `for(const f of fs.readdirSync(d)){` +
      `if(!f.endsWith(".jsonl"))continue;` +
      `try{const h=JSON.parse(fs.readFileSync(p.join(d,f),"utf8").split("\\n")[0]);` +
      `if(h[${JSON.stringify(MARKER)}]!==true)continue;` +
      `const base=f.slice(0,-".jsonl".length);` +
      `for(const ext of [".jsonl",".meta.json"]){try{fs.unlinkSync(p.join(d,base+ext))}catch{}}}catch{}}`,
  );
}

async function liveIds(): Promise<Set<string>> {
  const body = (await (await fetch(`http://localhost:${DASHBOARD_PORT}/api/sessions`)).json()) as {
    data?: Array<{ id: string }>;
  };
  return new Set((body.data ?? []).map((s) => s.id));
}

test.describe("pin does not resurrect archived sessions (fix-discovery-resurrects-archived)", () => {
  test.setTimeout(240_000);

  test.afterEach(async () => {
    await unpinViaBus(CWD).catch(() => undefined);
    try {
      cleanup();
    } catch {
      /* best-effort — the next run's entry cleanup heals */
    }
  });

  test("F4: pinning a folder keeps its archived sessions archived", async ({ page }) => {
    await unpinViaBus(CWD).catch(() => undefined);
    cleanup();
    inContainer(`mkdir -p ${CWD}`);
    const now = Date.now();
    const resident = seedSession(false, now - 3 * HOUR);
    const archived = [seedSession(true, now - 2 * HOUR), seedSession(true, now - HOUR)];
    await restartDashboard();
    // Positive control, planted AFTER boot so only the pin's discovery can
    // seed it: proves the pin really ran `.jsonl` discovery over this folder
    // (the pre-fix loop seeded every non-resident id it listed).
    const fresh = seedSession(null, now - HOUR / 2);
    await expect.poll(async () => (await liveIds()).has(resident), { timeout: 30_000 }).toBe(true);
    expect((await liveIds()).has(fresh)).toBe(false);

    await pinViaBus(CWD);
    await gotoDashboard(page);

    const toggle = page.getByTestId(`folder-archive-toggle-${CWD}`);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toContainText("Archive (2)");
    await expect
      .poll(async () => (await liveIds()).has(fresh), { timeout: 30_000, message: "pin discovery never ran" })
      .toBe(true);

    const live = await liveIds();
    for (const id of archived) expect(live.has(id), `archived ${id} became resident`).toBe(false);
    for (const id of archived) await expect(page.locator(`[data-session-id="${id}"]`)).toHaveCount(0);
    await expect(toggle).toContainText("Archive (2)");

    const res = await fetch(
      `http://localhost:${DASHBOARD_PORT}/api/sessions/archived?cwd=${encodeURIComponent(CWD)}&limit=50`,
    );
    const body = (await res.json()) as { data?: { items?: Array<{ id: string }> } };
    const listed = new Set((body.data?.items ?? []).map((r) => r.id));
    for (const id of archived) expect(listed.has(id), `archived ${id} missing from the index`).toBe(true);
  });
});
