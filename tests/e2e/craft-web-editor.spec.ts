/**
 * Browser E2E — the craft-web plugin edits files in the editor pane through the ArtCraft web builds.
 *
 * TABLE-DRIVEN (change: extend-craft-web-to-all-apps, design D9): `ROWS` holds one row per shipped app
 * claim; the per-row scenarios are test-plan F1 (open), F2 (save), F3 (dirty round trip), F5 (CSP),
 * F6 (rendering legs, `?webgl`), P1 (first open p95), plus F11 (v1-shim build keeps working) and F15
 * (toolbar contrast). The WordCraft-only scenarios of edit-office-in-pane-with-craft-web (Save As,
 * Export PDF, hyperlink, reload loss, refused open, disable mid-session) follow, prefixed "WordCraft:".
 *
 * Only a real browser + the real server can prove these: the production
 * `sandbox="allow-scripts"` frame (opaque origin, IndexedDB refused), the mount's
 * enforced CSP, the shim↔host postMessage protocol, host-origin device downloads
 * and the own-save banner convergence under a real file watch.
 *
 * ENABLING. `craft-web` is `defaultEnabled:false` and its `/apps/craft-wordcraft/`
 * mount + REST routes are restart-effective. `beforeAll` reads
 * `GET /api/plugins/craft-web/status` (404 = server entry not loaded); when it is
 * not `ok`-mountable it toggles the plugin on (`POST /api/plugins/craft-web/toggle`)
 * and `POST /api/restart`s, then `POST .../prepare/wordcraft` (real download of the
 * pinned WordCraft web build — the harness needs network; the first call is the
 * cold prepare P2 records). `afterAll` restores the original enabled state (+
 * restart). Exemplar for toggle+restart: tests/e2e/skill-atlas.spec.ts (#X13).
 *
 * FILES are seeded OUT OF BAND inside the harness container (`docker exec`,
 * exemplar tests/e2e/editor-pane-file-handler.spec.ts): `report.docx` is re-written
 * from the host fixture `docker/fixtures/sample-git/report.docx` before every test,
 * and the copies/extra fixtures are removed after.
 *
 * Steps that drive WordCraft's own UI (typing into the canvas, in-app Save As /
 * Export PDF menus, clicking a hyperlink in the canvas) are best-effort and marked
 * `TODO(spike)`; where the host behaviour is the claim, the step drives the SHIM's
 * stubbed browser APIs from inside the frame (`showSaveFilePicker`, anchor
 * download, `<a>` navigation) — exactly what WordCraft calls — so the host side is
 * proven deterministically.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Frame } from "@playwright/test";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { contrastFailures, measureText, setThemeMode } from "./helpers/computed-contrast.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

const DESKTOP = { width: 1440, height: 900 } as const;
const API = `http://localhost:${DASHBOARD_PORT}`;
const DOCX = "report.docx";
const COPY = "report.wordcraft.docx";
const LINK_DOCX = "linked.docx";
const ABS = (rel: string) => `${FIXTURE_GIT}/${rel}`;
const FIXTURE_DIR = path.join(REPO_ROOT, "docker", "fixtures", "sample-git");
const FIXTURE_BYTES = fs.readFileSync(path.join(FIXTURE_DIR, DOCX));
/** The plugin's data dir inside the harness container (`ctx.dataDir`, server user `pi`). */
const PLUGIN_DATA = "/home/pi/.pi/dashboard/plugin-data/craft-web";
/** Ready (60 s) + opened (15 s) host budgets, plus slack for the wasm download. */
const OPEN_TIMEOUT = 90_000;

// ---------------------------------------------------------------- container I/O

function inBox(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}
function writeBytesOob(rel: string, bytes: Uint8Array): void {
  const q = JSON.stringify(ABS(rel));
  inBox(`printf %s ${Buffer.from(bytes).toString("base64")} | base64 -d > ${q} && chmod 666 ${q}`);
}
const readBytesOob = (rel: string): Buffer => Buffer.from(inBox(`base64 < ${JSON.stringify(ABS(rel))} | tr -d '\\n'`), "base64");
const existsOob = (rel: string): boolean => inBox(`[ -e ${JSON.stringify(ABS(rel))} ] && echo y || echo n`) === "y";
const mtimeOob = (rel: string): string => inBox(`stat -c %y ${JSON.stringify(ABS(rel))}`);
const listOob = (): string[] => inBox(`ls -1A ${JSON.stringify(FIXTURE_GIT)}`).split("\n").sort();

// ---------------------------------------------------------------- tiny OOXML zip (no deps)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Store-only (method 0) zip of `files`. */
function zipStore(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Read one entry of a zip (stored or deflated); `null` when absent or not a zip. */
function unzipEntry(zip: Buffer, entry: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const skip = nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + nameLen) === entry) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    }
    p += 46 + skip;
  }
  return null;
}
/** Visible text of `word/document.xml` (tags stripped, so split runs still match). */
const docxText = (zip: Buffer): string | null => unzipEntry(zip, "word/document.xml")?.toString("utf8").replace(/<[^>]+>/g, "") ?? null;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** Minimal valid DOCX (passes the plugin's OOXML validator); optional external hyperlink. */
function makeDocx(text: string, link?: string): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
      (link ? `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>${link}</w:t></w:r></w:hyperlink></w:p>` : "") +
      "</w:body></w:document>",
  };
  if (link) {
    files["word/_rels/document.xml.rels"] =
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="${link}" TargetMode="External"/></Relationships>`;
  }
  return zipStore(files);
}

// ---------------------------------------------------------------- per-app rows (D9)

/**
 * One shipped app claim. `fixture` lives in `docker/fixtures/sample-git/` (host) and is re-seeded into
 * the session's git fixture before every test; `edit` makes the document dirty through the app's own UI;
 * `verify` checks the saved bytes contain the edit.
 */
interface CraftRow {
  appId: string;
  claimId: string;
  label: string;
  /** Workspace-relative file the row opens (copied from `fixtureSource`). */
  fixture: string;
  /** Host path relative to `docker/fixtures/sample-git/`. */
  fixtureSource: string;
  /** The app reports a document title (opened is confirmed). */
  titled: boolean;
  edit?: (page: Page, iframe: Locator) => Promise<void>;
  verify?: (saved: Buffer) => void;
  /** F3 dirty round trip runs for this row. */
  dirtyRoundTrip?: boolean;
  /** F15 toolbar contrast runs for this row (a plain edit claim). */
  contrast?: boolean;
  /** `inner-title` app: the first save always asks Save As (D10, F8). */
  saveAsFirst?: boolean;
}

const ROWS: readonly CraftRow[] = [
  {
    appId: "wordcraft",
    claimId: "wordcraft",
    label: "WordCraft",
    fixture: DOCX,
    fixtureSource: DOCX,
    titled: true,
    edit: (page, iframe) => typeInCanvas(page, iframe, "Edited in pane"),
    verify: (saved) => {
      expect(saved.subarray(0, 2).toString("latin1")).toBe("PK");
      expect(docxText(saved)).toContain("Edited in pane");
    },
  },
  // ---- Wave 1 (extend-craft-web-to-all-apps group 2). Edits drive each app's own UI.
  {
    appId: "gridcraft",
    claimId: "gridcraft",
    label: "GridCraft",
    fixture: "budget.xlsx",
    fixtureSource: "craft/budget.xlsx",
    titled: true,
    // Name Box (top-left, fixed offset) → C2, then type: robust to the frame width.
    edit: async (page, iframe) => {
      await iframe.click({ position: { x: 66, y: 186 } });
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("C2", { delay: 30 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("999", { delay: 30 });
      await page.keyboard.press("Enter");
    },
    verify: (saved) => expect(unzipEntry(saved, "xl/worksheets/sheet1.xml")?.toString("utf8")).toMatch(/<c r="C2"[^>]*><v>999<\/v>/),
    dirtyRoundTrip: true,
  },
  {
    appId: "pdfcraft",
    claimId: "pdfcraft",
    label: "PdfCraft",
    fixture: "doc.pdf",
    fixtureSource: "craft/doc.pdf",
    titled: false,
  },
  {
    appId: "cadcraft",
    claimId: "cadcraft",
    label: "CADCraft",
    fixture: "plan.dxf",
    fixtureSource: "craft/plan.dxf",
    titled: false,
    // Keystrokes go to CADCraft's command line.
    edit: async (page, iframe) => {
      await iframe.click({ position: { x: 300, y: 300 } });
      for (const step of ["CIRCLE", "10,10", "5"]) {
        await page.keyboard.type(step, { delay: 30 });
        await page.keyboard.press("Enter");
      }
    },
    verify: (saved) => expect(dxfCircles(saved)).toContainEqual({ x: 10, y: 10, r: 5 }),
    dirtyRoundTrip: true,
    contrast: true,
  },
  {
    appId: "designcraft",
    claimId: "designcraft",
    label: "DesignCraft",
    fixture: "mag.designcraft",
    fixtureSource: "craft/mag.designcraft",
    titled: false,
    verify: (saved) => expect(zipNames(saved).some((n) => n.startsWith("assets/"))).toBe(true),
  },
  {
    appId: "soundcraft",
    claimId: "soundcraft",
    label: "SoundCraft",
    fixture: "mix.scraftz",
    fixtureSource: "craft/mix.scraftz",
    titled: false,
    saveAsFirst: true,
  },
];

/** CIRCLE entities `{x, y, r}` of an ASCII DXF. */
function dxfCircles(bytes: Buffer): Array<{ x: number; y: number; r: number }> {
  const l = bytes.toString("latin1").split(/\r?\n/).map((x) => x.trim());
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i + 1 < l.length; i += 2) {
    if (l[i] !== "0" || l[i + 1] !== "CIRCLE") continue;
    const c: Record<string, number> = {};
    for (let j = i + 2; j + 1 < l.length && l[j] !== "0"; j += 2) c[l[j]] = Number(l[j + 1]);
    out.push({ x: c["10"], y: c["20"], r: c["40"] });
  }
  return out;
}

/** Member names of a zip (central directory). */
function zipNames(zip: Buffer): string[] {
  const names: string[] = [];
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) if (zip.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
  if (eocd < 0) return names;
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const nameLen = zip.readUInt16LE(p + 28);
    names.push(zip.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return names;
}

const APP_IDS = [...new Set(ROWS.map((r) => r.appId))];
const rowBytes = (r: CraftRow): Buffer => fs.readFileSync(path.join(FIXTURE_DIR, r.fixtureSource));
const modeOf = (r: CraftRow): string => `file-mode-craft-web/${r.claimId}`;

// ---------------------------------------------------------------- dashboard plumbing

interface AppStatus {
  status: string;
  reason?: string;
  sizeGzip?: number;
  cspViolations?: number;
  installedVersion?: string;
  shimVersion?: number;
  shimUpdate?: boolean;
}
async function craftStatus(app = "wordcraft"): Promise<{ http: number; app?: AppStatus }> {
  const res = await fetch(`${API}/api/plugins/craft-web/status`);
  if (!res.ok) return { http: res.status };
  const body = (await res.json()) as { apps?: Record<string, AppStatus> };
  return { http: res.status, app: body.apps?.[app] };
}
async function pluginEnabled(): Promise<boolean> {
  const res = await fetch(`${API}/api/plugins`);
  const body = (await res.json()) as { plugins?: Array<{ id: string; status?: { enabled?: boolean } | null }> };
  return body.plugins?.find((r) => r.id === "craft-web")?.status?.enabled === true;
}
async function togglePlugin(enabled: boolean): Promise<void> {
  const res = await fetch(`${API}/api/plugins/craft-web/toggle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  expect(res.ok, `toggle craft-web → ${enabled}: HTTP ${res.status}`).toBeTruthy();
}
async function restartDashboard(): Promise<void> {
  await fetch(`${API}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) return;
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}
async function prepare(app: string): Promise<{ wallMs: number; body: Record<string, unknown> }> {
  const t0 = Date.now();
  const res = await fetch(`${API}/api/plugins/craft-web/prepare/${app}`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  expect(res.ok, `prepare ${app}: HTTP ${res.status} ${JSON.stringify(body)}`).toBeTruthy();
  return { wallMs: Date.now() - t0, body };
}

let initiallyEnabled = false;
/** First prepare outcome per app of this run (P2 records it; cold on a fresh harness). */
const firstPrepare = new Map<string, { wallMs: number; body: Record<string, unknown> }>();

test.beforeAll(async () => {
  test.setTimeout(600_000 + APP_IDS.length * 120_000);
  initiallyEnabled = await pluginEnabled();
  const st = await craftStatus();
  if (st.http === 404 || st.app?.reason === "restart-required" || st.app?.reason === "disabled") {
    if (!initiallyEnabled) await togglePlugin(true);
    await restartDashboard();
  }
  for (const app of APP_IDS) {
    firstPrepare.set(app, await prepare(app));
    expect((await craftStatus(app)).app?.status, `${app} status after prepare`).toBe("ok");
  }
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  if (!initiallyEnabled) {
    await togglePlugin(false);
    await restartDashboard();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const r of ROWS) writeBytesOob(r.fixture, rowBytes(r));
});

test.afterEach(() => {
  inBox(`rm -f ${[COPY, "draft.docx", "report.pdf", LINK_DOCX].map((f) => JSON.stringify(ABS(f))).join(" ")}`);
  for (const r of ROWS) writeBytesOob(r.fixture, rowBytes(r));
});

async function sessionIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}
async function openInPane(page: Page, sid: string, rel: string): Promise<void> {
  await page.goto(`/session/${sid}/editor?file=${encodeURIComponent(rel)}`);
  await expect(page.getByTestId("split-editor-pane").first()).toBeVisible({ timeout: 20_000 });
}

/** Select the row's mode; resolve once the host saw `opened` (`data-phase="open"`). */
async function editIn(page: Page, row: CraftRow = ROWS[0]): Promise<{ host: Locator; iframe: Locator; frame: Frame; ms: number }> {
  const t0 = Date.now();
  await page.getByTestId(modeOf(row)).click();
  const host = page.getByTestId("craft-frame-host");
  await expect(host).toHaveAttribute("data-phase", "open", { timeout: OPEN_TIMEOUT });
  const ms = Date.now() - t0;
  const iframe = page.getByTestId("craft-frame");
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("craft-frame has no content frame");
  return { host, iframe, frame, ms };
}

async function freshEditor(page: Page, rel = DOCX, row: CraftRow = ROWS[0]) {
  const card = await spawnFreshGitSession(page);
  await openInPane(page, await sessionIdOf(card), rel);
  return editIn(page, row);
}

/**
 * Make the instance dirty by typing into the canvas.
 * TODO(spike): confirm WordCraft takes focus from a canvas click and routes keys
 * (eframe may use a hidden text input); adjust the click target if not.
 */
async function typeInCanvas(page: Page, iframe: Locator, text: string): Promise<void> {
  await iframe.click({ position: { x: 200, y: 200 } });
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text, { delay: 20 });
}

/** Answer core's once-per-instance first-overwrite notice when it appears (every edit claim declares one). */
async function confirmFirstOverwrite(page: Page): Promise<string> {
  const notice = page.getByTestId("file-handler-first-overwrite-dialog");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  const text = (await notice.textContent()) ?? "";
  await page.getByTestId("file-handler-first-overwrite-dialog-overwrite").click();
  return text;
}

/**
 * Drive the shim's stubbed `showSaveFilePicker` from inside the frame — the call
 * WordCraft's Save / Save As makes. Fire-and-forget: `close()` may wait on a host
 * dialog.
 */
async function shimSave(frame: Frame, name: string, bytes: Buffer): Promise<void> {
  await frame.evaluate(
    ({ b64, suggestedName }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const w = window as unknown as {
        showSaveFilePicker: (o: { suggestedName: string }) => Promise<{
          createWritable: () => Promise<{ write: (d: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
        }>;
      };
      void (async () => {
        const h = await w.showSaveFilePicker({ suggestedName });
        const ws = await h.createWritable();
        await ws.write(data);
        await ws.close();
      })().catch(() => undefined);
    },
    { b64: bytes.toString("base64"), suggestedName: name },
  );
}

// ---------------------------------------------------------------- per-app scenarios

for (const row of ROWS) {
  test.describe(`craft-web ${row.label} (${row.claimId}) on ${row.fixture}`, () => {
    test.describe.configure({ timeout: 240_000 });

    test(`F1: Edit in ${row.label} opens the sandboxed frame (${row.titled ? "confirmed" : "unconfirmed"}), no document data in its URL`, async ({ page }) => {
      const { iframe, frame } = await freshEditor(page, row.fixture, row);
      await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
      await expect(iframe).toHaveAttribute("allow", "clipboard-write");
      const src = (await iframe.getAttribute("src")) ?? "";
      expect(src).toMatch(new RegExp(`^/apps/craft-${row.appId}/index\\.html(\\?[a-z&]+)?#n=[A-Za-z0-9_-]+$`));
      expect(src).not.toContain(path.parse(row.fixture).name);
      expect(new URL(frame.url()).hash).toMatch(/^#n=/);
      await test.info().attach(`${row.appId}-canvas`, { body: await iframe.screenshot(), contentType: "image/png" });
    });

    test(`F2: edit + Ctrl/Cmd+S overwrites ${row.fixture} in place with the edit; no banner`, async ({ page }) => {
      const { iframe } = await freshEditor(page, row.fixture, row);
      const mtime0 = mtimeOob(row.fixture);
      await row.edit?.(page, iframe);
      if (!row.edit) await iframe.click({ position: { x: 300, y: 300 } }); // focus the app for its Save chord
      await page.keyboard.press("ControlOrMeta+s");
      if (row.saveAsFirst) {
        await expect(page.getByTestId("craft-save-as")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("craft-save-as-overwrite").click();
      }
      const notice = await confirmFirstOverwrite(page);
      if (!row.titled) expect(notice).toContain(`${row.label} does not report which file it opened.`);
      // A no-edit save may write identical bytes: the write itself (mtime) is the observable then.
      if (row.edit) await expect.poll(() => !readBytesOob(row.fixture).equals(rowBytes(row)), { timeout: 30_000 }).toBe(true);
      else await expect.poll(() => mtimeOob(row.fixture) !== mtime0, { timeout: 30_000 }).toBe(true);
      row.verify?.(readBytesOob(row.fixture));
      await page.waitForTimeout(2_500); // settle + catch-up windows
      await expect(page.getByTestId("changed-on-disk-banner")).toHaveCount(0);
    });

    if (row.dirtyRoundTrip) {
      test("F3: dirty round trip — close prompts while dirty; after an acknowledged save it does not", async ({ page }) => {
        const { iframe } = await freshEditor(page, row.fixture, row);
        await row.edit?.(page, iframe);
        const tab = page.getByTestId("editor-tab").filter({ hasText: path.basename(row.fixture) });
        await tab.click({ button: "middle" });
        await expect(page.getByTestId("file-handler-guard-dialog")).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("file-handler-guard-dialog-cancel").click();
        await page.keyboard.press("ControlOrMeta+s");
        await confirmFirstOverwrite(page);
        await expect.poll(() => !readBytesOob(row.fixture).equals(rowBytes(row)), { timeout: 30_000 }).toBe(true);
        await page.waitForTimeout(1_000);
        await tab.click({ button: "middle" });
        await expect(page.getByTestId("file-handler-guard-dialog")).toHaveCount(0);
        await expect(page.getByTestId("craft-frame-host")).toHaveCount(0, { timeout: 15_000 });
      });
    }

    test("F5: the frame cannot reach the network or the dashboard API; the violation is reported server-side", async ({ page }) => {
      const external: string[] = [];
      await page.context().route("https://example.com/**", (r) => {
        external.push(r.request().url());
        return r.abort();
      });
      const { frame } = await freshEditor(page, row.fixture, row);
      const cspBefore = (await craftStatus(row.appId)).app?.cspViolations ?? 0;
      const results = await frame.evaluate(async () => {
        const probe = async (u: string) => {
          try {
            await fetch(u);
            return "resolved";
          } catch {
            return "rejected";
          }
        };
        return { external: await probe("https://example.com"), api: await probe("/api/health") };
      });
      expect(results).toEqual({ external: "rejected", api: "rejected" });
      expect(external).toEqual([]);
      await expect.poll(async () => (await craftStatus(row.appId)).app?.cspViolations ?? 0, { timeout: 20_000 }).toBeGreaterThan(cspBefore);
    });

    for (const leg of ["default", "webgl"] as const) {
      test(`F6: rendering leg ${leg} — opened within the host budgets, IndexedDB refused`, async ({ page }) => {
        if (leg === "webgl") {
          // Hide WebGPU from the host probe so it picks `?webgl` (WebGL2 via SwiftShader).
          await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
        }
        const { iframe, frame, ms } = await freshEditor(page, row.fixture, row);
        if (leg === "webgl") expect(await iframe.getAttribute("src")).toMatch(/[?&]webgl(&|#)/);
        expect(ms).toBeLessThan(60_000 + 15_000);
        const idb = await frame.evaluate(
          () =>
            new Promise<string>((resolve) => {
              try {
                const req = indexedDB.open("craft-e2e-probe");
                req.onsuccess = () => resolve("opened");
                req.onerror = () => resolve("refused");
              } catch {
                resolve("refused");
              }
            }),
        );
        expect(idb).toBe("refused");
        test.info().annotations.push({ type: `F6 ${row.appId} ${leg}`, description: `opened in ${ms} ms` });
      });
    }

    test("P1: mode select → opened, 5 opens, p95 ≤ 10 s (prepared build)", async ({ page }) => {
      test.setTimeout(900_000);
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
      const card = await spawnFreshGitSession(page);
      const sid = await sessionIdOf(card);
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        await openInPane(page, sid, row.fixture); // a fresh page load → fresh page-level handler layer
        runs.push((await editIn(page, row)).ms);
      }
      const sorted = [...runs].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
      test.info().annotations.push({ type: `P1 ${row.appId}`, description: JSON.stringify({ runs, p95, prepare: firstPrepare.get(row.appId) }) });
      expect(p95, `P1 ${row.appId} runs=${JSON.stringify(runs)}`).toBeLessThanOrEqual(10_000);
    });

    if (row.contrast) {
      test("F15: every toolbar text node ≥ 4.5:1 in base dark, base light and Nord dark (target overwrite selected)", async ({ page }) => {
        const card = await spawnFreshGitSession(page);
        await openInPane(page, await sessionIdOf(card), row.fixture);
        await editIn(page, row);
        const failures: string[] = [];
        for (const [mode, theme] of [
          ["dark", "base"],
          ["light", "base"],
          ["dark", "nord"],
        ] as const) {
          await setThemeMode(page, mode, theme);
          const toolbar = page.getByTestId("craft-save-target").locator("xpath=..");
          await expect(page.getByTestId("craft-save-target-overwrite")).toHaveAttribute("aria-pressed", "true", { timeout: OPEN_TIMEOUT });
          const ms = await measureText(toolbar);
          expect(ms.length, `${theme}-${mode}: toolbar text measured`).toBeGreaterThan(2);
          failures.push(...contrastFailures(ms).map((f) => `${theme}-${mode}: ${f}`));
        }
        expect(failures).toEqual([]);
      });
    }
  });
}

// ---------------------------------------------------------------- Wave 1 single-app scenarios

const rowOf = (claimId: string): CraftRow => ROWS.find((r) => r.claimId === claimId) as CraftRow;

test.describe("craft-web Wave 1 scenarios", () => {
  test.describe.configure({ timeout: 240_000 });

  test("F4: unconfirmed open (CADCraft) asks ONE question; Save as copy creates plan.cadcraft.dxf, plan.dxf unchanged", async ({ page }) => {
    const row = rowOf("cadcraft");
    const { iframe } = await freshEditor(page, row.fixture, row);
    await row.edit?.(page, iframe);
    await page.keyboard.press("ControlOrMeta+s");
    const notice = page.getByTestId("file-handler-first-overwrite-dialog");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("does not report which file it opened");
    await page.getByTestId("file-handler-first-overwrite-dialog-copy").click();
    await expect.poll(() => existsOob("plan.cadcraft.dxf"), { timeout: 30_000 }).toBe(true);
    expect(readBytesOob(row.fixture).equals(rowBytes(row))).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("file-handler-first-overwrite-dialog")).toHaveCount(0);
    await expect(page.getByTestId("craft-save-as")).toHaveCount(0);
    inBox(`rm -f ${JSON.stringify(ABS("plan.cadcraft.dxf"))}`);
  });

  test("F8: session-named save (SoundCraft) — first save asks, Overwrite; the second save writes without a question", async ({ page }) => {
    const row = rowOf("soundcraft");
    const { iframe } = await freshEditor(page, row.fixture, row);
    const mtime0 = mtimeOob(row.fixture);
    await iframe.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("craft-save-as")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("craft-save-as")).toContainText("names saves after the session inside the file");
    await page.getByTestId("craft-save-as-overwrite").click();
    await confirmFirstOverwrite(page);
    await expect.poll(() => mtimeOob(row.fixture) !== mtime0, { timeout: 30_000 }).toBe(true);
    const first = mtimeOob(row.fixture);
    await page.waitForTimeout(1_100);
    await iframe.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => mtimeOob(row.fixture) !== first, { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId("craft-save-as")).toHaveCount(0);
    await expect(page.getByTestId("file-handler-first-overwrite-dialog")).toHaveCount(0);
    expect(unzipEntry(readBytesOob(row.fixture), "Audio Files/tone.wav")).not.toBeNull();
  });
});

// ---------------------------------------------------------------- shim compatibility (D8)

test.describe("craft-web shim compatibility", () => {
  test.describe.configure({ timeout: 300_000 });

  /**
   * F11: seed a WordCraft tree carrying only the v1 marker (no profile line / script) and point `current`
   * at it. The shim file is the current one; without `window.__CRAFT_PROFILE__` it runs the v1 title rule
   * (the v1 host-side `opened` contract is pinned by L1 #E12).
   */
  test("F11: a v1-shim WordCraft build keeps loading — no prepare, no release fetch — and settings offers Update", async ({ page }) => {
    const root = `${PLUGIN_DATA}/wordcraft-web`;
    inBox(
      [
        `set -e; R=${JSON.stringify(root)}; CUR=$(readlink -f "$R/current"); V1="$R/0.8.0-s1"`,
        `rm -rf "$V1"; cp -a "$CUR" "$V1"; cd "$V1"`,
        `sed -i -e '/<!-- craft-profile:/d' -e '/craft-profile-[0-9a-f]*\\.js/d' -e 's/<!-- craft-shim:[0-9]* -->/<!-- craft-shim:1 -->/' index.html`,
        `rm -f craft-profile-*.js craft-profile-*.js.gz index.html.gz; gzip -9 -k index.html`,
        `SIZE=$(node -e 'console.log(require("./craft-build.json").sizeGzip)')`,
        `printf '{"app":"wordcraft","version":"0.8.0","shimVersion":1,"sizeGzip":%s}\\n' "$SIZE" > craft-build.json`,
        `ln -sfn 0.8.0-s1 "$R/current.tmp" && mv -T "$R/current.tmp" "$R/current"`,
      ].join("; "),
    );
    const st = (await craftStatus()).app;
    expect(st).toMatchObject({ status: "ok", shimVersion: 1, shimUpdate: true });

    const prepares: string[] = [];
    const releases: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/plugins/craft-web/prepare/")) prepares.push(r.url());
      if (/github(usercontent)?\.com/.test(r.url())) releases.push(r.url());
    });
    const logBefore = inBox("wc -l < /home/pi/.pi/dashboard/server.log 2>/dev/null || echo 0");
    await freshEditor(page, DOCX);
    expect(prepares).toEqual([]);
    expect(releases).toEqual([]);
    const newLog = inBox(`tail -n +$((${Number(logBefore) || 0} + 1)) /home/pi/.pi/dashboard/server.log 2>/dev/null || true`);
    expect(newLog).not.toMatch(/prepare wordcraft (ok|failed)/);

    await page.goto("/settings/plugins/craft-web");
    await expect(page.getByTestId("craft-web-wordcraft-prepare")).toHaveText("Update WordCraft", { timeout: 30_000 });
    // Leave the harness on the current build for the rest of the run.
    await prepare("wordcraft");
    expect((await craftStatus()).app).toMatchObject({ status: "ok", shimVersion: 2 });
  });
});

// ---------------------------------------------------------------- WordCraft-only scenarios

test.describe("craft-web WordCraft-only (edit-office-in-pane-with-craft-web)", () => {
  test.describe.configure({ timeout: 240_000 });

  test("P2: prepare — duration + served gzip bytes (measure-only)", async () => {
    const st = await craftStatus();
    const first = firstPrepare.get("wordcraft");
    const rec = {
      prepareWallMs: first?.wallMs,
      prepareDurationMs: first?.body.durationMs,
      cacheHit: first?.body.cacheHit,
      version: first?.body.version,
      sizeGzip: st.app?.sizeGzip ?? first?.body.sizeGzip,
    };
    console.log(`[P2] ${JSON.stringify(rec)}`);
    test.info().annotations.push({ type: "P2 prepare", description: JSON.stringify(rec) });
  });

  test("WordCraft F3: in-app Save As draft.docx → host dialog first; Save as copy writes report.wordcraft.docx", async ({ page }) => {
    const { frame } = await freshEditor(page);
    // TODO(spike): drive WordCraft's own File ▸ Save As menu and name field; this
    // makes the same `showSaveFilePicker({suggestedName:"draft.docx"})` call.
    await shimSave(frame, "draft.docx", makeDocx("save as copy"));

    const dlg = page.getByTestId("craft-save-as");
    await expect(dlg).toBeVisible({ timeout: 20_000 });
    await expect(dlg).toContainText("draft.docx");
    expect(existsOob(COPY)).toBe(false); // nothing written before the choice
    expect(existsOob("draft.docx")).toBe(false);
    expect(readBytesOob(DOCX).equals(FIXTURE_BYTES)).toBe(true);

    await page.getByTestId("craft-save-as-copy").click();
    await expect.poll(() => existsOob(COPY), { timeout: 20_000 }).toBe(true);
    expect(docxText(readBytesOob(COPY))).toContain("save as copy");
    expect(existsOob("draft.docx")).toBe(false);
    expect(readBytesOob(DOCX).equals(FIXTURE_BYTES)).toBe(true);
  });

  test("WordCraft F4: in-app Export PDF → host-origin download report.pdf; no new workspace file", async ({ page }) => {
    const { frame } = await freshEditor(page);
    const before = listOob();
    const download = page.waitForEvent("download", { timeout: 30_000 });
    // TODO(spike): drive WordCraft's own Export ▸ PDF; this is the anchor download it performs.
    await frame.evaluate(() => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }));
      a.download = "report.pdf";
      document.body.append(a);
      a.click();
      a.remove();
    });
    expect((await download).suggestedFilename()).toBe("report.pdf");
    await page.waitForTimeout(1_000);
    expect(listOob()).toEqual(before);
  });

  test("WordCraft F6: activating a hyperlink keeps the editor loaded and offers a new tab", async ({ page }) => {
    writeBytesOob(LINK_DOCX, makeDocx("Has a link", "https://example.com/"));
    const { host, iframe, frame } = await freshEditor(page, LINK_DOCX);
    await typeInCanvas(page, iframe, " edit");
    // TODO(spike): Ctrl/Cmd+click the hyperlink text in the canvas instead; this is
    // the cross-document navigation it causes.
    await frame.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://example.com/";
      document.body.append(a);
      a.click();
    });
    await expect(page.getByTestId("craft-nav-offer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("craft-nav-open")).toBeVisible();
    await expect(host).toHaveAttribute("data-phase", "open");
    await expect(page.getByTestId("craft-reloaded")).toHaveCount(0);
    expect(new URL(frame.url()).pathname).toBe("/apps/craft-wordcraft/index.html");
  });

  test("WordCraft F7: a navigated frame is dropped with 'unsaved edits were lost' + Resume; no new open", async ({ page }) => {
    const { iframe, frame } = await freshEditor(page);
    await typeInCanvas(page, iframe, "will be lost");
    // Browser-initiated reload of the frame document. A query change makes it cross-document: the
    // same URL with only the #n= fragment would be a same-document navigation (no load, nothing lost).
    await frame.goto(`${frame.url().split("#")[0]}?reload=1`).catch(() => undefined);
    const panel = page.getByTestId("craft-reloaded");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("The editor reloaded. Unsaved edits were lost.");
    await expect(page.getByTestId("craft-reloaded-retry")).toHaveText("Resume");
    // The host dropped the frame: no iframe left to receive another `open`.
    await expect(page.getByTestId("craft-frame")).toHaveCount(0);
  });

  test("WordCraft F8: opening a local file from inside the app is refused; the next save still targets report.docx", async ({ page }) => {
    const { frame } = await freshEditor(page);
    // TODO(spike): use WordCraft's own File ▸ Open (file chooser) / a desktop drop.
    const picker = await frame.evaluate(async () => {
      const input = document.createElement("input");
      input.type = "file";
      document.body.append(input);
      input.click();
      try {
        await (window as unknown as { showOpenFilePicker: () => Promise<unknown> }).showOpenFilePicker();
        return "opened";
      } catch (e) {
        return (e as Error).name;
      }
    });
    expect(picker).toBe("AbortError");
    await expect(page.getByTestId("craft-blocked-toast")).toHaveText("Open other files from the dashboard", { timeout: 15_000 });

    await shimSave(frame, DOCX, makeDocx("still report"));
    await confirmFirstOverwrite(page);
    await expect.poll(() => docxText(readBytesOob(DOCX)), { timeout: 20_000 }).toContain("still report");
  });

  test("WordCraft X7: disabling the plugin mid-session keeps the dirty instance behind a re-enable/discard overlay", async ({ page }) => {
    const { iframe } = await freshEditor(page);
    await typeInCanvas(page, iframe, "keep me");
    // The client follows `/api/health.plugins[]`, which only reports a plugin as disabled after a
    // server restart (activation is restart-effective), and refreshes on `plugin-config-update`
    // (the DOM event `useMessageHandler` re-emits from the `plugin_config_update` WS frame). Serve
    // the post-restart health and emit that event, instead of restarting the shared harness
    // (a restart drops the fixture-plugin gate for every later spec).
    await page.route("**/api/health", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { plugins?: Array<{ id: string; enabled?: boolean }> };
      for (const p of body.plugins ?? []) if (p.id === "craft-web") p.enabled = false;
      await route.fulfill({ response: res, json: body });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("plugin-config-update")));
    const overlay = page.getByTestId("file-handler-disabled-overlay");
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("file-handler-reenable")).toBeVisible();
    await expect(page.getByTestId("file-handler-discard")).toBeVisible();
    // Edits intact: the same frame is still mounted and open (not dropped, not reloaded).
    await expect(page.getByTestId("craft-frame")).toHaveCount(1);
    await expect(page.getByTestId("craft-frame-host")).toHaveAttribute("data-phase", "open");
    await expect(page.getByTestId("craft-reloaded")).toHaveCount(0);
  });
});
