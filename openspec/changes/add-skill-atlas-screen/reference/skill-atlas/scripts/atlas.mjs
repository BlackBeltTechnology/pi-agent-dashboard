#!/usr/bin/env node
// Skill Atlas CLI — deterministic generator for the skill catalog + link graph page.
//
//   node atlas.mjs build   [--dir D]        scan + merge summaries + render -> D/index.html
//   node atlas.mjs check   [--dir D] [--json]  summary gaps: missing/stale/redo/drifted/invalid
//   node atlas.mjs todo    [--dir D] [id..] [--major-only]  source material (+ body diffs) per gap
//   node atlas.mjs stamp   [--dir D] id.. | --all   mark summaries reviewed (hashes + snapshot)
//   node atlas.mjs redo    [--dir D] id..   force a rewrite of these summaries
//   node atlas.mjs verify  [--dir D]        rebuild twice in memory, compare with D/index.html
//   node atlas.mjs scan    [--dir D]        write D/skills.json only
//   node atlas.mjs projects [--dir D] [--suggest]  projects pi is resolved in (first = primary)
//
// Data dir D (default $SKILL_ATLAS_DIR or ~/AssistantProject/tools/skill-atlas) holds:
//   summaries.json  authored prose layer (the only hand/LLM-written input)
//   .stamps/<id>.md body snapshot taken at the last review, used for drift diffs
//   atlas.config.json  optional: "roots" (scanned folders), "projects" (pi reference
//                      projects, first = primary; default [~/AssistantProject])
//   skills.json, index.html  generated outputs — never hand-edit
//
// Same skill files + same summaries.json + same template => byte-identical index.html.
// No timestamps unless SOURCE_DATE_EPOCH is set.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scan as scanRaw, DEFAULT_ROOTS, sha } from './lib/scan.mjs';
import { resolveProjects, suggestProjects, expandHome, tildify } from './lib/pi-resolve.mjs';
import { build } from './lib/build.mjs';
import { check, stamp, serialize, descHash, markRedo, needsWork, renderDiff, DRIFT_RATIO } from './lib/summaries.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, '..', 'assets', 'template.html');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flag = n => argv.includes(n);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE_OPTS = new Set(['--dir', '--body-lines']);
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !VALUE_OPTS.has(all[i]) && !VALUE_OPTS.has(all[i - 1]));

const DIR = path.resolve((opt('--dir') || process.env.SKILL_ATLAS_DIR ||
  path.join(os.homedir(), 'AssistantProject/tools/skill-atlas')).replace(/^~(?=\/|$)/, os.homedir()));
const P = f => path.join(DIR, f);

function readJson(f, fallback) {
  if (!fs.existsSync(f)) return fallback;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const CFG = readJson(P('atlas.config.json'), {});
function roots() {
  return Array.isArray(CFG.roots) && CFG.roots.length ? CFG.roots : DEFAULT_ROOTS;
}
// Projects pi is asked about. The FIRST is the primary: its loaded copy is the one shown and
// summarized. "projects": [] (or legacy "piCwd": null) disables the resolver.
// Legacy "piCwd": "<dir>" = a one-project list.
function projectList() {
  let list;
  if (Array.isArray(CFG.projects)) list = CFG.projects.map(p => (typeof p === 'string' ? { cwd: p } : p));
  else if (CFG.piCwd === null) list = [];
  else list = [{ cwd: CFG.piCwd || '~/AssistantProject' }];
  // unique labels: basename, or parent/basename when two projects share a basename
  const base = p => path.basename(path.resolve(expandHome(p.cwd)));
  return list.map(p => ({ ...p, label: p.label || (list.filter(q => base(q) === base(p)).length > 1
    ? path.basename(path.dirname(path.resolve(expandHome(p.cwd)))) + '/' + base(p) : base(p)) }));
}
let RESOLVED;
async function resolveOnce() {
  if (!RESOLVED) {
    const list = projectList();
    RESOLVED = list.length ? await resolveProjects(list, { piPackageDir: CFG.piPackageDir })
                           : { resolver: 'none', note: 'resolver disabled (no projects configured)', projects: [] };
    if (RESOLVED.note) console.error('note:', RESOLVED.note);
    for (const p of RESOLVED.projects) if (!p.ok && p.note) console.error('note: project ' + tildify(p.cwd) + ': ' + p.note);
  }
  return RESOLVED;
}
async function scan() { return scanRaw(roots(), await resolveOnce()); }
function generated() {
  const e = process.env.SOURCE_DATE_EPOCH;
  return e && /^\d+$/.test(e) ? new Date(Number(e) * 1000).toISOString() : null;
}
// hash of the generator's own code: a changed page is always traceable to inputs OR code
const GENERATOR_HASH = sha(['atlas.mjs', 'lib/scan.mjs', 'lib/build.mjs', 'lib/summaries.mjs', 'lib/pi-resolve.mjs']
  .map(f => fs.readFileSync(path.join(HERE, f), 'utf8')).join('\u0000')).slice(0, 16);
function render(payload, summaries) {
  const out = build(payload, summaries, fs.readFileSync(TEMPLATE, 'utf8'), { generated: generated(), generatorHash: GENERATOR_HASH });
  return out;
}
function report(r) {
  const line = (label, xs, fmt = x => x) =>
    console.log(label.padEnd(13) + xs.length + (xs.length ? '  ' + xs.map(fmt).join(', ') : ''));
  const withNote = id => id + ' (' + r.driftInfo[id].note + ')';
  console.log('— needs work (check exits 1):');
  line('missing', r.missing);
  line('stale', r.stale);
  line('redo', r.redo);
  line('drifted', r.drifted, withNote);
  line('invalid', r.invalid);
  console.log('— informational:');
  line('minor drift', r.minorDrift, withNote);
  line('unstamped', r.unstamped);
  line('orphans', r.orphans);
}
const forJson = r => { const { driftInfo, ...rest } = r;
  rest.drift = Object.fromEntries(Object.entries(driftInfo).map(([k, d]) => [k, { major: d.major, note: d.note }]));
  return rest; };

if (!['help', '--help', '-h'].includes(cmd)) fs.mkdirSync(DIR, { recursive: true });

switch (cmd) {
  case 'scan': {
    const payload = await scan();
    fs.writeFileSync(P('skills.json'), JSON.stringify(payload, null, 1) + '\n');
    console.log('skills:', payload.skills.length, '| links:', payload.links.length, '| fingerprint:', payload.fingerprint);
    break;
  }

  case 'build': {
    const payload = await scan();
    const summaries = readJson(P('summaries.json'), {});
    const { html, missing } = render(payload, summaries);
    fs.writeFileSync(P('skills.json'), JSON.stringify(payload, null, 1) + '\n');
    fs.writeFileSync(P('index.html'), html);
    const r = check(DIR, payload, summaries);
    const lt = {};
    for (const l of payload.links) lt[l.type] = (lt[l.type] || 0) + 1;
    console.log('wrote', P('index.html'), (html.length / 1024).toFixed(0) + ' KB');
    console.log('skills:', payload.skills.length, '| links:', payload.links.length, JSON.stringify(lt));
    console.log('sha256:', sha(html).slice(0, 16), '| scan fingerprint:', payload.fingerprint, '| generator:', GENERATOR_HASH, '| unsummarized:', missing);
    if (needsWork(r)) { console.log('\nsummary gaps (run `check` / `todo`):'); report(r); }
    break;
  }

  case 'check': {
    const payload = await scan();
    const r = check(DIR, payload, readJson(P('summaries.json'), {}));
    if (flag('--json')) console.log(JSON.stringify(forJson(r), null, 2)); else report(r);
    process.exitCode = needsWork(r) ? 1 : 0;
    break;
  }

  case 'todo': {
    // Everything an agent needs to (re)write or review the gap summaries, without opening
    // other files. Positional ids restrict the list. Minor drift is included by default:
    // a 12-line rename (pi-dashboard hide->archive) once made a summary wrong.
    const payload = await scan();
    const summaries = readJson(P('summaries.json'), {});
    const r = check(DIR, payload, summaries);
    const reason = {};
    const tag = (ids, why) => ids.forEach(id => (reason[id] ||= []).push(why));
    tag(r.missing, 'MISSING — write a new entry');
    tag(r.stale, 'STALE — description changed, rewrite what it contradicts');
    tag(r.redo, 'REDO — explicitly requested rewrite');
    tag(r.drifted, 'DRIFTED — body changed, review the diff');
    if (!flag('--major-only')) tag(r.minorDrift, 'MINOR DRIFT — small body change, review the diff');
    let ids = Object.keys(reason).sort();
    if (positional.length) ids = ids.filter(id => positional.includes(id));
    if (!ids.length) { console.log('nothing to do — every summary is present, current and reviewed'); break; }
    const limit = Number(opt('--body-lines') || 60);
    for (const id of ids) {
      const s = payload.skills.find(x => x.id === id);
      const body = s.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n');
      const d = r.driftInfo[id];
      console.log('\n======== ' + id + '  [' + reason[id].join(' + ') + ']');
      console.log('path: ' + s.path + '\npkg: ' + (s.npmName || s.pkg) + ' | tier: ' + s.tier + ' | lines: ' + s.lines);
      console.log('tools: ' + (s.tools.join(', ') || '-'));
      console.log('description: ' + s.description);
      console.log('headings: ' + s.headings.join(' / '));
      if (summaries[id]) console.log('current summary: ' + JSON.stringify(summaries[id]));
      // a drift-only entry gets the diff instead of a body excerpt — that is the review input
      if (d && d.ops && !r.missing.includes(id) && !r.stale.includes(id) && !r.redo.includes(id)) {
        console.log('--- body diff since last review (' + d.note + ') ---');
        console.log(renderDiff(d.ops).join('\n'));
      } else {
        if (d) console.log('body drift since last review: ' + d.note);
        console.log('--- body (first ' + limit + ' lines of ' + body.length + ') ---');
        console.log(body.slice(0, limit).join('\n'));
      }
    }
    console.log('\nAfter writing/reviewing: node atlas.mjs stamp ' + ids.join(' '));
    break;
  }

  case 'stamp': {
    const payload = await scan();
    const summaries = readJson(P('summaries.json'), {});
    if (!positional.length && !flag('--all')) {
      console.error('stamp needs the ids you reviewed (or --all to stamp every entry — rarely right:\n' +
        'stamping claims each summary was re-read against the current SKILL.md)');
      process.exitCode = 2; break;
    }
    const known = new Set(payload.skills.map(s => s.id));
    const unknown = positional.filter(id => !known.has(id) || !summaries[id]);
    if (unknown.length) console.error('ignored (no skill or no summary entry):', unknown.join(', '));
    const { done, refused } = stamp(DIR, payload, summaries, flag('--all') ? 'ALL' : positional);
    fs.writeFileSync(P('summaries.json'), serialize(summaries));
    console.log('stamped', done.length, done.length ? '(' + done.join(', ') + ')' : '— already current');
    if (refused.length) { console.error('refused (unsafe id):', refused.join(', ')); process.exitCode = 1; }
    break;
  }

  case 'redo': {
    if (!positional.length) { console.log('usage: atlas.mjs redo <id> [id..]'); process.exitCode = 2; break; }
    const summaries = readJson(P('summaries.json'), {});
    const { done, unknown } = markRedo(summaries, positional);
    fs.writeFileSync(P('summaries.json'), serialize(summaries));
    console.log('marked for rewrite:', done.join(', ') || '-');
    if (unknown.length) console.log('no summary entry (will show as missing anyway):', unknown.join(', '));
    break;
  }

  case 'verify': {
    const summaries = readJson(P('summaries.json'), {});
    const a = render(await scan(), summaries).html;
    const b = render(await scan(), summaries).html;
    const disk = fs.existsSync(P('index.html')) ? fs.readFileSync(P('index.html'), 'utf8') : '';
    console.log('run 1  ', sha(a).slice(0, 16));
    console.log('run 2  ', sha(b).slice(0, 16));
    console.log('on disk', disk ? sha(disk).slice(0, 16) : '(none)');
    const stable = a === b, fresh = a === disk;
    console.log(stable ? 'deterministic: yes' : 'deterministic: NO — two runs differ');
    console.log(fresh ? 'index.html is up to date' : 'index.html is out of date — run `build`');
    process.exitCode = stable && fresh ? 0 : 1;
    break;
  }

  case 'projects': {
    const r = await resolveOnce();
    console.log('resolver:', r.resolver);
    if (!r.projects.length) console.log('(no projects configured — copy choice falls back to scan-root order)');
    const payload = r.projects.length ? scanRaw(roots(), r) : null;
    for (const p of r.projects) {
      const n = Object.keys(p.loaded).length;
      const differs = payload ? payload.skills.filter(s => s.loadedIn.some(l => l.project === p.label && !l.same)).length : 0;
      console.log((p.primary ? '* ' : '  ') + p.label.padEnd(26) + (p.ok ? String(n).padStart(3) + ' skills loaded' +
        (differs ? ', ' + differs + ' with a different text than shown' : '') : 'NOT RESOLVED: ' + p.note) + '   ' + tildify(p.cwd));
    }
    console.log('(* = primary: its copies are shown and summarized; set "projects" in ' + tildify(P('atlas.config.json')) + ')');
    if (flag('--suggest')) {
      const have = new Set(r.projects.map(p => p.cwd));
      const sug = suggestProjects().filter(x => !have.has(x.cwd));
      console.log('\nsuggested additions (' + sug.length + '):');
      for (const x of sug) console.log('  ' + tildify(x.cwd).padEnd(60) + x.why);
      console.log('\nadd them as  "projects": ["~/AssistantProject", "<dir>", …]  — keep the primary first.');
    }
    break;
  }

  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 25).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
