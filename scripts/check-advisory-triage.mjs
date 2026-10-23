#!/usr/bin/env node
/**
 * check-advisory-triage — cross-checks a committed `pnpm audit --json` snapshot
 * against `advisory-triage.md` (change: harden-cors-and-csp-reporting, B26r, D11).
 *
 *   node scripts/check-advisory-triage.mjs [--snapshot <file>] [--triage <file>] [--xlsx]
 *
 * Triage rules (exit 1, one `error:` line per violation, naming the id/row):
 *   - every GHSA id in the snapshot has exactly one triage row (missing / duplicate)
 *   - class ∈ {reachable, build-only, accepted}
 *   - reason non-empty
 *   - the row carries `https://github.com/advisories/<same id>`
 *   - `reachable` rows name an owning change id (empty or `n/a` fails)
 * A triage id absent from the snapshot is STALE: one `warning:` line, still exit 0.
 * Rows under a heading containing "URL-tarball" (packages `pnpm audit` cannot see,
 * e.g. the xlsx CDN pin) are not diffed against the snapshot but still need a link.
 *
 * `--xlsx` adds the CDN-pin check: the `xlsx` URL in packages/server/package.json
 * must have a pnpm-lock.yaml resolution entry for that exact URL carrying
 * `integrity: sha512-…` (88 base64 chars) whose version equals the URL's version.
 *
 * Relative --snapshot/--triage paths resolve from the repo root.
 * Reads only the files it is given; never spawns pnpm/npm; no network. Exit 2 on
 * a script failure (unreadable / unparseable input).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLASSES = ["reachable", "build-only", "accepted"];
const ADVISORY_BASE = "https://github.com/advisories/";
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/gi;
const NO_OWNER = new Set(["", "n/a", "na", "none", "-", "—", "tbd"]);

const CHANGE_DIR = "openspec/changes/harden-cors-and-csp-reporting";
export const DEFAULT_SNAPSHOT = `${CHANGE_DIR}/advisory-audit-snapshot.json`;
export const DEFAULT_TRIAGE = `${CHANGE_DIR}/advisory-triage.md`;
const SERVER_PKG = "packages/server/package.json";
const LOCKFILE = "pnpm-lock.yaml";

/** `pnpm audit --json` text → Map<GHSA id, { packages: string[], severity: string }>. */
export function parseSnapshot(text) {
  const data = JSON.parse(text);
  const advisories = data && typeof data === "object" ? data.advisories : undefined;
  if (!advisories || typeof advisories !== "object") {
    throw new Error("snapshot has no `advisories` object (is it `pnpm audit --json` output?)");
  }
  const ids = new Map();
  for (const adv of Object.values(advisories)) {
    const id = String(adv?.github_advisory_id ?? "").trim();
    if (!id) continue;
    const entry = ids.get(id) ?? { packages: [], severity: String(adv.severity ?? "") };
    if (adv.module_name && !entry.packages.includes(adv.module_name)) entry.packages.push(adv.module_name);
    ids.set(id, entry);
  }
  return ids;
}

const clean = (cell) => cell.replace(/`/g, "").trim();
const splitRow = (line) => {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
};
const isSeparator = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const idsIn = (text) => [...new Set((text.match(GHSA_RE) ?? []).map(canonId))];
// GHSA ids are `GHSA-` upper + lowercase groups; normalise any case to that form.
const canonId = (id) => `GHSA-${id.slice(5).toLowerCase()}`;

/**
 * Triage markdown → { rows, urlRows }. A row is any table line whose advisory cell
 * (2nd column) cites a GHSA id. Table lines under a heading containing
 * "URL-tarball" go to `urlRows` (link-checked, never diffed against the snapshot).
 */
export function parseTriage(text) {
  const rows = [];
  const urlRows = [];
  let inUrlSection = false;
  text.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    if (/^#{1,6}\s/.test(line)) {
      inUrlSection = /url-tarball/i.test(line);
      return;
    }
    if (!line.trim().startsWith("|")) return;
    const cells = splitRow(line);
    if (isSeparator(cells)) return;
    const advisoryCell = cells[1] ?? "";
    const ids = idsIn(advisoryCell);
    if (ids.length === 0) return;
    const row = {
      lineNo,
      raw: line.trim(),
      cells,
      ids,
      advisoryCell,
      pkg: clean(cells[0] ?? ""),
      cls: clean(cells[3] ?? ""),
      reason: clean(cells[4] ?? ""),
      owner: clean(cells[5] ?? ""),
    };
    (inUrlSection ? urlRows : rows).push(row);
  });
  return { rows, urlRows };
}

const linkMissing = (row, id) => !row.advisoryCell.includes(`${ADVISORY_BASE}${id}`);

/**
 * Pure cross-check. Returns `{ errors: [{ id, rule, message }], warnings: string[] }`;
 * exit status is `errors.length ? 1 : 0`.
 */
export function checkTriage({ snapshotText, triageText }) {
  const errors = [];
  const warnings = [];
  const snapshot = parseSnapshot(snapshotText);
  const { rows, urlRows } = parseTriage(triageText);
  const err = (id, rule, message) => errors.push({ id, rule, message: `${id}: ${rule} — ${message}` });

  const byId = new Map();
  for (const row of rows) {
    for (const id of row.ids) {
      byId.set(id, [...(byId.get(id) ?? []), row]);
    }
  }

  for (const id of [...snapshot.keys()].sort()) {
    const hits = byId.get(id) ?? [];
    if (hits.length === 0) err(id, "missing", "advisory is in the audit snapshot but has no triage row");
    else if (hits.length > 1) {
      err(id, "duplicate", `${hits.length} triage rows (lines ${hits.map((r) => r.lineNo).join(", ")}); exactly one allowed`);
    }
  }

  for (const row of rows) {
    const where = `line ${row.lineNo}`;
    for (const id of row.ids) {
      if (linkMissing(row, id)) err(id, "link", `${where}: row lacks ${ADVISORY_BASE}${id}`);
    }
    const label = row.ids.join(",");
    if (!CLASSES.includes(row.cls)) {
      err(label, "class", `${where}: class "${row.cls}" not in {${CLASSES.join(", ")}}`);
    }
    if (row.reason === "") err(label, "reason", `${where}: reason is empty`);
    if (row.cls === "reachable" && NO_OWNER.has(row.owner.toLowerCase())) {
      err(label, "owner", `${where}: reachable row must name an owning change id (got "${row.owner}")`);
    }
    for (const id of row.ids) {
      if (!snapshot.has(id)) warnings.push(`warning: stale triage row ${id} (stale: not in the audit snapshot) — ${where}`);
    }
  }

  for (const row of urlRows) {
    for (const id of row.ids) {
      if (linkMissing(row, id)) err(id, "link", `line ${row.lineNo}: URL-tarball row lacks ${ADVISORY_BASE}${id}`);
    }
  }
  return { errors, warnings };
}

const SHA512_RE = /^sha512-[A-Za-z0-9+/]{86}==$/;
const urlVersion = (url) => /\/xlsx-([0-9][^/]*)\/xlsx-\1\.tgz$/.exec(url)?.[1];

/**
 * xlsx CDN-pin check. `packageJsonText` = packages/server/package.json,
 * `lockText` = pnpm-lock.yaml. Returns `{ errors: string[], url?, version? }`.
 * The lock "version" is the entry's explicit `version:` when present, else the
 * version segment of the lock's own resolution URL (pnpm records no `version:`
 * field for tarball deps); it must equal the package.json URL's version segment.
 */
export function checkXlsxPin({ packageJsonText, lockText }) {
  const errors = [];
  const pkg = JSON.parse(packageJsonText);
  const url = ["dependencies", "devDependencies", "optionalDependencies"]
    .map((k) => pkg?.[k]?.xlsx)
    .find((v) => typeof v === "string");
  if (!url) return { errors: ["xlsx: no `xlsx` dependency in package.json"] };
  const pinVersion = urlVersion(url);
  if (!pinVersion) return { errors: [`xlsx: URL "${url}" is not of the form …/xlsx-<ver>/xlsx-<ver>.tgz`] };

  const lines = lockText.split("\n");
  const key = lines.findIndex((l) => /^ {2}['"]?xlsx@/.test(l) && l.includes(url) && l.trimEnd().endsWith(":"));
  if (key === -1) return { errors: [`xlsx: pnpm-lock.yaml has no packages entry for exactly ${url}`], url };
  const block = [];
  for (let i = key + 1; i < lines.length && /^ {3,}\S/.test(lines[i]); i++) block.push(lines[i]);
  const body = block.join("\n");

  const integrity = /integrity:\s*([^,}\s]+)/.exec(body)?.[1];
  if (!integrity) errors.push(`xlsx: lock entry for ${url} has no \`integrity\``);
  else if (!SHA512_RE.test(integrity)) {
    errors.push(`xlsx: lock integrity "${integrity}" is not sha512-<88 base64 chars incl. ==>`);
  }
  const tarball = /tarball:\s*([^,}\s]+)/.exec(body)?.[1];
  if (tarball && tarball !== url) errors.push(`xlsx: lock tarball ${tarball} differs from package.json URL ${url}`);

  const explicit = /^\s*version:\s*['"]?([^'"\s]+)/m.exec(body)?.[1];
  const lockVersion = explicit ?? urlVersion(tarball ?? url);
  if (lockVersion !== pinVersion) {
    errors.push(`xlsx: lock version "${lockVersion}" != package.json URL version "${pinVersion}"`);
  }
  return { errors, url, version: pinVersion };
}

/**
 * CLI body. `io` is injectable for tests: `readFile(path)` (utf-8 text), `stdout`, `stderr`.
 * Returns the exit code (0 ok, 1 violations, 2 script failure).
 */
export function runCli(argv, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, "utf-8"));
  const out = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const errOut = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  const root = io.root ?? "";
  const abs = (p) => (root ? resolve(root, p) : p);
  let snapshot = DEFAULT_SNAPSHOT;
  let triage = DEFAULT_TRIAGE;
  let xlsx = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--snapshot") snapshot = argv[++i];
    else if (argv[i] === "--triage") triage = argv[++i];
    else if (argv[i] === "--xlsx") xlsx = true;
    else {
      errOut(`error: unknown argument ${argv[i]}`);
      return 2;
    }
  }
  try {
    const { errors, warnings } = checkTriage({
      snapshotText: readFile(abs(snapshot)),
      triageText: readFile(abs(triage)),
    });
    for (const w of warnings) errOut(w);
    for (const e of errors) errOut(`error: ${e.message}`);
    let failed = errors.length > 0;
    if (xlsx) {
      const pin = checkXlsxPin({
        packageJsonText: readFile(abs(SERVER_PKG)),
        lockText: readFile(abs(LOCKFILE)),
      });
      for (const e of pin.errors) errOut(`error: ${e}`);
      failed ||= pin.errors.length > 0;
    }
    if (!failed) out(`advisory triage OK (${warnings.length} stale warning(s))`);
    return failed ? 1 : 0;
  } catch (e) {
    errOut(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const here = dirname(fileURLToPath(import.meta.url));
  process.exitCode = runCli(process.argv.slice(2), { root: resolve(here, "..") });
}
