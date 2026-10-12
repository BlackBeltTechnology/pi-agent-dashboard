#!/usr/bin/env node
// Self-test for the skill-atlas toolset. Runs entirely in a temp dir with fake skill roots;
// never touches the real data dir. Usage: node selftest.mjs   (exit 0 = all pass)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'atlas.mjs');
const lib = f => import(pathToFileURL(path.join(HERE, 'lib', f)).href);
const { scan } = await lib('scan.mjs');
const { diffLines } = await lib('summaries.mjs');
const { piLoaded } = await lib('pi-resolve.mjs');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-selftest-'));
const R1 = path.join(T, 'root1'), R2 = path.join(T, 'root2'), D = path.join(T, 'data');
const roots = [{ p: R1, origin: 'user', label: 'Root 1' }, { p: R2, origin: 'global', label: 'Root 2' }];

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? '   ' + extra : ''));
};
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--dir', D], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
};
const skill = (root, dir, name, desc, body) => {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n' + body);
};
const lines = n => Array.from({ length: n }, (_, i) => 'line ' + i).join('\n') + '\n';
const entry = id => ({ id, oneLiner: 'x', summary: 'x', useWhen: 'x', dontUse: '', category: 'Coding', keySteps: ['x'], cost: 'free' });
const writeSummaries = o => fs.writeFileSync(path.join(D, 'summaries.json'), JSON.stringify(o, null, 2) + '\n');
const sha = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

// ---------- fixture ----------
fs.mkdirSync(D, { recursive: true });
fs.writeFileSync(path.join(D, 'atlas.config.json'), JSON.stringify({ roots, piCwd: null }));
skill(R1, 'alpha', 'alpha', 'Alpha skill v1.', '# Alpha\n## Steps\n' + lines(30) + 'Hand off to beta-skill when done.\n');
skill(R1, 'beta', 'beta-skill', 'Beta skill.', '# Beta\nUse the `canvas` tool. Edit only what changed.\n');
skill(R2, 'beta', 'beta-skill', 'Beta skill.', '# Beta\nUse the `canvas` tool. Edit only what changed.\n');          // identical copy
skill(R1, 'gamma', 'gamma', 'Gamma.', '# Gamma v1\n');
skill(R2, 'gamma', 'gamma', 'Gamma.', '# Gamma v2 — newer and much longer text than root 1\n' + lines(20)); // divergent copy
writeSummaries({ alpha: entry('alpha'), 'beta-skill': entry('beta-skill'), gamma: entry('gamma') });

// ---------- 1. determinism ----------
run(['build']);
const h1 = sha(path.join(D, 'index.html'));
run(['build']);
ok(h1 && h1 === sha(path.join(D, 'index.html')), 'determinism: two builds are byte-identical');
const D2 = path.join(T, 'data2');
fs.mkdirSync(D2); for (const f of ['atlas.config.json', 'summaries.json']) fs.copyFileSync(path.join(D, f), path.join(D2, f));
spawnSync(process.execPath, [CLI, 'build', '--dir', D2]);
ok(h1 === sha(path.join(D2, 'index.html')), 'determinism: a second data dir gives the same bytes');
ok(run(['verify']).code === 0, 'determinism: verify exits 0');
spawnSync(process.execPath, [CLI, 'build', '--dir', D2], { env: { ...process.env, SOURCE_DATE_EPOCH: '1760000000' } });
const h3 = sha(path.join(D2, 'index.html'));
ok(h3 !== h1 && h3.includes('"generated":"2025-10-09T08:53:20.000Z"'), 'determinism: SOURCE_DATE_EPOCH adds exactly a fixed date');

// ---------- 2. dedupe ----------
const p0 = scan(roots);
const beta = p0.skills.find(s => s.id === 'beta-skill'), gamma = p0.skills.find(s => s.id === 'gamma');
ok(gamma.raw.includes('Gamma v1'), 'dedupe: earlier root wins, not the longer body');
ok(gamma.divergentPaths.length === 1 && beta.divergentPaths.length === 0, 'dedupe: divergent copy flagged, identical copy not');
const pL = scan(roots, { resolver: 'test', cwd: T, loaded: { gamma: path.join(R2, 'gamma', 'SKILL.md') } });
const gL = pL.skills.find(s => s.id === 'gamma');
ok(gL.raw.includes('Gamma v2') && gL.loaded === true, 'dedupe: the copy pi loads wins over root order');
ok(pL.fingerprint !== p0.fingerprint, 'dedupe: resolver answer is part of the fingerprint');

// ---------- 3. tool detection + links ----------
ok(beta.tools.includes('canvas') && !beta.tools.includes('Edit'), 'tools: `canvas` counted, prose "Edit only" not');
ok(p0.links.some(l => l.type === 'references' && l.source === 'alpha' && l.target === 'beta-skill'), 'links: SKILL.md mention -> references link');

// ---------- 4. summary lifecycle ----------
ok(run(['stamp']).code === 2, 'stamp: no ids and no --all is refused (exit 2)');
ok(run(['stamp', '--all']).code === 0 && run(['check']).code === 0, 'stamp --all, then check exits 0');
const alpha = path.join(R1, 'alpha', 'SKILL.md');
fs.writeFileSync(alpha, fs.readFileSync(alpha, 'utf8').replace('line 5\n', 'line five\n'));
let c = run(['check']);
ok(c.code === 0 && /minor drift\s+1\s+alpha/.test(c.out), 'drift: 1-line edit = minor, non-blocking');
ok(/MINOR DRIFT/.test(run(['todo']).out), 'drift: todo lists minor drift by default');
ok(!/alpha/.test(run(['todo', '--major-only']).out.split('\n').filter(l => l.startsWith('====')).join('')), 'drift: --major-only hides it');
fs.appendFileSync(alpha, '## New section\nnew\n');
c = run(['check']);
ok(c.code === 1 && /drifted\s+1\s+alpha .*headings changed/.test(c.out), 'drift: new heading = drifted, blocking');
ok(/\+ ## New section/.test(run(['todo']).out), 'drift: todo prints the body diff');
fs.writeFileSync(alpha, fs.readFileSync(alpha, 'utf8').replace('Alpha skill v1.', 'Alpha skill v2.'));
ok(/stale\s+1\s+alpha/.test(run(['check']).out), 'stale: description change detected');
run(['stamp', 'alpha']);
ok(run(['check']).code === 0, 'stamp <id> clears stale + drift');
run(['redo', 'gamma']);
c = run(['check']);
ok(c.code === 1 && /redo\s+1\s+gamma/.test(c.out), 'redo: marks a rewrite, check blocks');
run(['stamp', 'gamma']);
ok(run(['check']).code === 0, 'redo: cleared by stamp');
ok(/^======== alpha/m.test((fs.appendFileSync(alpha, '## Another\nx\n'), run(['todo', '--body-lines', '5', 'alpha'])).out),
   'args: --body-lines value is not mistaken for a skill id');
run(['stamp', 'alpha']);

// ---------- 5. new skill ----------
skill(R1, 'delta', 'delta', 'Delta.', '# Delta\n');
ok(/missing\s+1\s+delta/.test(run(['check']).out), 'missing: new skill detected');
fs.rmSync(path.join(R1, 'delta'), { recursive: true });

// ---------- 6. path traversal ----------
skill(R1, 'evil', '../../pwned', 'Evil.', '# Evil\n');
const s6 = JSON.parse(fs.readFileSync(path.join(D, 'summaries.json'), 'utf8')); s6['../../pwned'] = entry('../../pwned'); writeSummaries(s6);
const st = run(['stamp', '--all']);
const escaped = ['pwned.md', '../pwned.md'].map(f => path.resolve(D, '.stamps', '..', f)).concat(path.join(T, 'pwned.md'));
ok(!escaped.some(f => fs.existsSync(f)) && st.code === 1 && /refused \(unsafe id\)/.test(st.out), 'traversal: unsafe id refused, nothing written outside .stamps/');
ok(/unsafe skill id/.test(run(['check']).out), 'traversal: check reports it as invalid');
fs.rmSync(path.join(R1, 'evil'), { recursive: true });

// ---------- 7. diff cap ----------
const big = diffLines(lines(2500), lines(2500).replace('line 7', 'x'));
ok(big.tooLarge === true, 'diff: oversized bodies are not diffed (memory cap)');

// ---------- 8. HTML escaping ----------
skill(R1, 'xss', 'xss-test', '"<script>alert(1)</script>"', '# X\n</script><img src=x onerror=alert(2)> [a](javascript:alert(3))\n');
run(['build']);
const html = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
const dataBlock = html.slice(html.indexOf('<script id="data"'), html.indexOf('</script>', html.indexOf('<script id="data"')));
ok(!/<img src=x|<script>alert/.test(dataBlock), 'escaping: hostile skill text cannot break out of the data block');
ok(html.split('</script>').length === 3, 'escaping: page still has exactly its 2 script blocks');
fs.rmSync(path.join(R1, 'xss'), { recursive: true });

// ---------- 9. multi-project copy selection (synthetic resolver answers) ----------
{
  const g1 = path.join(R1, 'gamma', 'SKILL.md'), g2 = path.join(R2, 'gamma', 'SKILL.md');
  const proj = (label, primary, loaded) => ({ cwd: path.join(T, label), label, primary, ok: true, loaded });
  const shown = projects => scan(roots, { resolver: 'test', projects }).skills.find(s => s.id === 'gamma');
  ok(shown([proj('A', true, { gamma: g2 }), proj('B', false, { gamma: g1 })]).raw.includes('Gamma v2'),
     'multi: primary project\'s copy wins over root order');
  ok(shown([proj('A', true, {}), proj('B', false, { gamma: g2 }), proj('C', false, { gamma: g2 }), proj('D', false, { gamma: g1 })]).raw.includes('Gamma v2'),
     'multi: primary does not load it -> copy loaded in most projects wins');
  const a = shown([proj('A', true, { gamma: g1 }), proj('B', false, { gamma: g2 }), proj('C', false, { gamma: g2 })]);
  const b = shown([proj('A', true, { gamma: g1 }), proj('C', false, { gamma: g2 }), proj('B', false, { gamma: g2 })]);
  ok(a.raw === b.raw && a.raw.includes('Gamma v1'), 'multi: reordering non-primary projects never changes the shown copy');
  ok(a.loadedIn.length === 3 && a.loadedIn.filter(l => !l.same).map(l => l.project).join() === 'B,C',
     'multi: loadedIn marks which projects run a different text');
  const pr = scan(roots, { resolver: 'test', projects: [proj('A', true, { gamma: g1 })] });
  ok(pr.resolver.projects.length === 1 && pr.resolver.projects[0].primary, 'multi: payload lists projects with the primary flagged');
}

// ---------- 10. copy switch lifecycle through the CLI with the REAL pi resolver ----------
{
  const PA = path.join(T, 'projA'), PB = path.join(T, 'projB');
  skill(path.join(PA, '.pi', 'skills'), 'zeta-st', 'zeta-st', 'Zeta.', '# Zeta\nText of project A.\n');
  skill(path.join(PB, '.pi', 'skills'), 'zeta-st', 'zeta-st', 'Zeta.', '# Zeta\nText of project B, which differs.\n');
  const cfg = projects => fs.writeFileSync(path.join(D, 'atlas.config.json'), JSON.stringify({ roots, projects }));
  const s10 = JSON.parse(fs.readFileSync(path.join(D, 'summaries.json'), 'utf8'));
  s10['zeta-st'] = entry('zeta-st'); writeSummaries(s10);
  cfg([PA, PB]);
  const pr = run(['projects']);
  if (/resolver: none/.test(pr.out)) console.log('SKIP copy-switch: pi resolver unavailable');
  else {
    ok(/\* projA/.test(pr.out) && /projB .*1 with a different text than shown/.test(pr.out), 'switch: `projects` shows primary + per-project differences');
    // the real resolver also loads your globally installed skills, so judge zeta-st only
    const zeta = () => { const j = JSON.parse(run(['check', '--json']).out.replace(/^note:.*$/mg, ''));
      return ['missing', 'stale', 'redo', 'drifted', 'minorDrift'].filter(k => j[k].includes('zeta-st')).concat(
        j.drift['zeta-st'] ? [j.drift['zeta-st'].note] : []); };
    run(['stamp', 'zeta-st']);
    ok(zeta().length === 0, 'switch: stamped under primary A', JSON.stringify(zeta()));
    cfg([PB, PA]);                                         // make B the primary
    let z = zeta();
    ok(z[0] === 'drifted' && /^shown copy switched from/.test(z[1] || ''), 'switch: new primary with unreviewed text -> "shown copy switched", blocking', JSON.stringify(z));
    run(['stamp', 'zeta-st']);
    cfg([PA, PB]);                                         // back to A: already reviewed
    z = zeta();
    ok(z.length === 0, 'switch: switching back to an already-reviewed text flags nothing', JSON.stringify(z));
    cfg([PA, path.join(T, 'x', 'projA')]);
    fs.mkdirSync(path.join(T, 'x', 'projA'), { recursive: true });
    ok(/x\/projA/.test(run(['projects']).out), 'switch: projects with the same folder name get distinct labels');
  }
  fs.writeFileSync(path.join(D, 'atlas.config.json'), JSON.stringify({ roots, piCwd: null }));
  const s10b = JSON.parse(fs.readFileSync(path.join(D, 'summaries.json'), 'utf8')); delete s10b['zeta-st']; writeSummaries(s10b);
}

// ---------- 11. provenance of project files ----------
{
  const PC = path.join(T, 'projC');
  skill(path.join(PC, '.pi', 'skills'), 'omega-st', 'omega-st', 'Omega.', '# Omega\n');
  const pr = scan(roots, { resolver: 'test', projects: [{ cwd: PC, label: 'projC', primary: true, ok: true, loaded: { 'omega-st': path.join(PC, '.pi', 'skills', 'omega-st', 'SKILL.md') } }] });
  const om = pr.skills.find(s => s.id === 'omega-st');
  ok(om && om.tier === 'yours' && om.pkg === 'project:projC' && om.originLabel === 'Project: projC',
     'provenance: a skill checked into a configured project is yours, grouped per project');
}

// ---------- 12. real pi resolver (skipped if pi is not installed) ----------
const real = await piLoaded(os.homedir());
if (real.resolver === 'none') console.log('SKIP pi resolver: ' + real.note);
else ok(Object.keys(real.loaded).length > 0 && Object.values(real.loaded).every(p => p.endsWith('SKILL.md') || p.endsWith('.md')),
        'resolver: ' + real.resolver + ' reports loaded skills with file paths');

fs.rmSync(T, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
