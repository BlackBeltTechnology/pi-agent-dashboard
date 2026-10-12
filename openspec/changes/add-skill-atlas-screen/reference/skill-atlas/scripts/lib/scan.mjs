// Skill Atlas scanner — walks every pi skill root, extracts metadata + relationships.
// Pure and deterministic: same files on disk => byte-identical payload. No wall clock,
// no unsorted directory reads, no Map-insertion-order dependence.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const HOME = os.homedir();
export const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// origin roots, in precedence order (earlier wins on dedupe). Overridable per data dir
// via atlas.config.json { "roots": [{ "p": "~/x", "origin": "user", "label": "..." }] }.
export const DEFAULT_ROOTS = [
  { p: HOME + '/AssistantProject/.pi/skills',        origin: 'project',   label: 'Project (AssistantProject)' },
  { p: HOME + '/AssistantProject/.pi/npm',           origin: 'project',   label: 'Project (AssistantProject)' },
  { p: HOME + '/.pi/agent/skills',                   origin: 'user',      label: 'User-installed' },
  { p: HOME + '/.pi/agent/pi-hermes-memory/skills',  origin: 'user',      label: 'User-installed' },
  { p: HOME + '/.pi/agent/npm',                      origin: 'global',    label: 'Global npm packages' },
  { p: HOME + '/projects/pi-agent-dashboard/packages', origin: 'dashboard', label: 'pi-dashboard source' },
];

const SKIP_DIR = new Set(['.git', 'dist', 'build', 'coverage', '.next', 'out', 'examples']);

// ---- provenance -------------------------------------------------------------
// Walk up from the SKILL.md to the nearest package.json — that is the thing that
// actually shipped the skill, so its name/author/repo is the real publisher.
function nearestPkg(fp) {
  let d = path.dirname(fp);
  for (let i = 0; i < 12; i++) {
    const c = path.join(d, 'package.json');
    if (fs.existsSync(c)) {
      try {
        const j = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (j.name) return { json: j, dir: d };
      } catch { /* unreadable package.json — keep walking */ }
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function repoUrl(j) {
  if (!j) return '';
  const r = j.repository;
  const u = typeof r === 'string' ? r : (r && r.url) || j.homepage || '';
  return String(u).replace(/^git\+/, '').replace(/\.git$/, '').replace(/#readme$/, '');
}

function authorOf(j) {
  if (!j) return '';
  const a = j.author;
  if (!a) return '';
  const s = typeof a === 'string' ? a : a.name || '';
  return s.replace(/\s*<[^>]*>\s*/g, '').replace(/\s*\([^)]*\)\s*/g, '').trim();
}

// Four trust tiers, in the order a reader cares about:
//   yours       — you (or your agent) wrote it on this machine
//   generated   — emitted by a CLI/tool into this repo, not hand-authored
//   inhouse     — your own org's packages (BlackBelt / pi-dashboard)
//   third-party — someone else's npm plugin
// configured pi reference projects (set per scan) — files checked into them are yours
let PROJECT_DIRS = [];
function provenance(fp, fm, pkg) {
  const j = pkg && pkg.json;
  const author = authorOf(j);
  const repo = repoUrl(j);
  const fmAuthor = (String(fm.metadata || '') .match(/author:\s*([^\s,]+)/) || [])[1] || '';

  let tier, who, why;

  if (fmAuthor && /openspec/i.test(fmAuthor)) {
    tier = 'generated';
    who = 'OpenSpec CLI';
    why = 'written into .pi/skills/ by the openspec CLI — regenerated, not hand-edited';
  } else if (fp.includes('/.pi/agent/skills/') || fp.includes('/pi-hermes-memory/skills/')) {
    tier = 'yours';
    who = 'You / your agent';
    why = 'lives in your personal ~/.pi/agent skill folder — authored here, not installed';
  } else if (fp.includes('/AssistantProject/.pi/skills/')) {
    tier = 'yours';
    who = 'You (AssistantProject)';
    why = 'checked into this workspace at .pi/skills/';
  } else if (!fp.includes('/node_modules/') && PROJECT_DIRS.some(p => fp.startsWith(p.dir + '/') && !fp.startsWith(HOME + '/projects/pi-agent-dashboard/'))) {
    const p = PROJECT_DIRS.filter(p => fp.startsWith(p.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
    tier = 'yours';
    who = 'You (project ' + p.label + ')';
    why = 'checked into your project ' + p.label + ' — loaded there by pi';
  } else if (/BlackBeltTechnology|blackbelt-technology/i.test(repo + ' ' + (j ? j.name : ''))) {
    tier = 'inhouse';
    who = author || 'BlackBelt Technology';
    why = 'ships with the pi-agent-dashboard project you work on';
  } else {
    tier = 'third-party';
    who = author || (j ? j.name : 'unknown publisher');
    why = 'installed from npm — third-party code you did not write';
  }

  return {
    tier, author: who, authorWhy: why,
    npmName: j ? j.name : '',
    npmVersion: j ? j.version : '',
    repo,
    license: (j && j.license) || fm.license || '',
  };
}

const TIER_LABEL = {
  yours: 'Yours',
  generated: 'Tool-generated',
  inhouse: 'In-house',
  'third-party': '3rd-party plugin',
};

function walk(dir, depth, acc) {
  if (depth > 10) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  // readdir order is filesystem-dependent; sort so dedupe winners never depend on it
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(fp, depth + 1, acc);
    } else if (e.name === 'SKILL.md') {
      acc.push(fp);
    }
  }
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; fm[key] = kv[2].trim(); }
    else if (key && /^\s+/.test(line)) { fm[key] = (fm[key] + ' ' + line.trim()).trim(); }
  }
  for (const k of Object.keys(fm)) {
    fm[k] = fm[k].replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  }
  return { fm, body: raw.slice(m[0].length) };
}

// package name = nearest node_modules/<pkg> or packages/<pkg>, else folder above skills/
function pkgOf(fp) {
  let m = fp.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g);
  if (m) { const last = m[m.length - 1]; return last.replace('node_modules/', ''); }
  m = fp.match(/\/packages\/([^/]+)\//);
  if (m) return m[1];
  // project-local skills are grouped per owning project, not into one machine-wide bucket
  m = fp.match(/^(.*)\/\.pi\/skills\//);
  if (m) return 'project:' + path.basename(m[1]);
  return 'standalone';
}

const TOOL_VOCAB = [
  'web_search','source_check','fetch_content','get_search_content','browser','canvas',
  'kb_search','kb_get','kb_neighbors','knowledge_add','knowledge_search','knowledge_symbol_search',
  'knowledge_update','knowledge_remove','knowledge_doctor','knowledge_status',
  'ctx_execute','ctx_execute_file','ctx_batch_execute','ctx_index','ctx_search','ctx_stats',
  'ctx_purge','ctx_doctor','ctx_fetch_and_index','ctx_upgrade','ctx_insight',
  'memory','memory_search','session_search','skill_manage','recall','obsidian',
  'ask_user','ask_user_question','Agent','Bash','Read','Write','Edit','Grep','Glob',
  'firecrawl_scrape','firecrawl_crawl','firecrawl_map','firecrawl_search',
  'init_research','remember_claim','verify_claim','recall_memory','synthesize',
  'plan_next_step','draft_research_plan','research_status','research_graph','export_dashboard',
  'vkf_run_experiment','vkf_log_experiment','research_update','set_research_mode','promote_to_global',
  'serve_mockup','score_mockup','validate_mockup','init_ui_contract','list_design_systems',
  'list_models','list_roles','update_roles','flow_results','research','health',
];

function categorize(id, desc, body, pkg) {
  const t = (id + ' ' + desc + ' ' + pkg).toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('research','literature','claim','hypothesis','vkf','synthes')) return 'Research';
  if (has('knowledge','kb-','ctx-','index','search','memory','distill','obsidian','context-mode')) return 'Knowledge';
  if (has('debug','review','test','scenario','simplif','security','performance','observab','doubt','interview','spec','openspec')) return 'Rigor';
  if (has('frontend','mockup','design','slop','ui','video','banana','image','forms','bpmn')) return 'Design';
  if (has('dashboard','plugin','flow','doctor','init','scaffold','browser','playwright','cost','apple','tool')) return 'Workspace';
  return 'Other';
}

// A skill id becomes a file name (.stamps/<id>.md) and an HTML anchor, and comes straight
// from third-party frontmatter. Anything outside this shape is refused for file use.
export const isSafeId = id => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes('..');

const realOf = p => { try { return fs.realpathSync(p); } catch { return p; } };

// Tool detection. Snake_case names (web_search) are distinctive anywhere; plain words
// (Edit, Read, memory, canvas, browser) only count in code form: `name`, name( or name().
// Bare prose matching once turned "Edit only what…" into an Edit-tool user.
function toolUsed(t, body) {
  const q = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (t.includes('_')) return new RegExp('(^|[^A-Za-z0-9_])' + q + '([^A-Za-z0-9_]|$)').test(body);
  return new RegExp('`' + q + '(\\(\\)?)?`|(^|[^A-Za-z0-9_.])' + q + '\\(').test(body);
}

// scan(roots, resolved): `resolved` comes from lib/pi-resolve.mjs::resolveProjects —
// { resolver, projects: [{ cwd, label, primary, ok, loaded: { name: absPath } }] }, first =
// primary. (Legacy single shape { resolver, cwd, loaded } is still accepted.)
export function scan(rootsIn = DEFAULT_ROOTS, resolved = { resolver: 'none', projects: [] }) {
const ROOTS = rootsIn.map(r => ({ ...r, p: r.p.replace(/^~(?=\/|$)/, HOME) }));
const projects = (resolved.projects || (resolved.loaded
  ? [{ cwd: resolved.cwd, label: resolved.cwd ? path.basename(resolved.cwd) : 'primary', primary: true, ok: true, loaded: resolved.loaded }]
  : [])).filter(p => p.ok).map(p => ({ ...p, real: new Map(Object.entries(p.loaded).map(([n, f]) => [n, realOf(f)])) }));
const primary = projects.find(p => p.primary) || null;
PROJECT_DIRS = projects.filter(p => p.cwd).map(p => ({ dir: realOf(p.cwd), label: p.label }));
// ---- collect ----
const files = [];
for (const r of ROOTS) walk(r.p, 0, files);
// a copy pi loads from outside the scan roots (another project's .pi/skills, ~/.agents/skills)
// is still a candidate
const seenReal = new Set(files.map(realOf));
const extra = new Set();
for (const p of projects) for (const f of p.real.values()) if (!seenReal.has(f) && fs.existsSync(f)) extra.add(f);
for (const f of [...extra].sort()) files.push(f);
// which project contributed an out-of-root file (first configured project that loads it)
const extraOwner = new Map();
for (const p of projects) for (const f of p.real.values()) if (extra.has(f) && !extraOwner.has(f)) extraOwner.set(f, p.label);

const candidates = new Map();   // id -> [{ rec, rank, real }]
for (const fp of files) {
  if (/\/examples\//.test(fp)) continue;
  const rel = fp.replace(HOME, '~');
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { continue; }
  const { fm, body } = parseFrontmatter(raw);
  const dirName = path.basename(path.dirname(fp));
  const id = (fm.name || dirName).trim();
  if (!id) continue;

  const rootIdx = ROOTS.findIndex(r => fp.startsWith(r.p));
  const root = ROOTS[rootIdx];
  const owner = root ? null : extraOwner.get(realOf(fp));
  const origin = root ? root.origin : owner ? 'project-other' : 'other';
  const originLabel = root ? root.label : owner ? 'Project: ' + owner : 'Loaded by pi (outside scan roots)';
  const pkg = pkgOf(fp);
  const prov = provenance(fp, fm, nearestPkg(fp));

  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim()).slice(0, 24);

  // full readable sections: ## heading + its prose, so the atlas can show the actual skill
  const sections = [];
  {
    const parts = body.split(/^##\s+/m);
    const intro = parts[0].replace(/^#\s+.*$/m, '').trim();
    if (intro) sections.push({ h: 'Overview', c: intro.slice(0, 2600) });
    for (const p of parts.slice(0, 30)) {
      const nl = p.indexOf('\n');
      if (nl < 0) continue;
      const h = p.slice(0, nl).trim();
      const c = p.slice(nl + 1).trim();
      if (!h || !c || h.startsWith('-')) continue;
      sections.push({ h, c: c.slice(0, 2600) });
    }
  }

  // name-rule validation, per the Agent Skills spec pi enforces
  const warnings = [];
  if (!fm.description) warnings.push('no description in frontmatter — pi will NOT load this skill');
  if (!fm.name) warnings.push('no name in frontmatter (folder name used)');
  const nm = fm.name || '';
  if (nm) {
    if (nm.length > 64) warnings.push('name longer than 64 chars');
    if (!/^[a-z0-9-]+$/.test(nm)) warnings.push('name must be lowercase a-z, 0-9 and hyphens only');
    if (/^-|-$/.test(nm)) warnings.push('name has a leading/trailing hyphen');
    if (/--/.test(nm)) warnings.push('name has consecutive hyphens');
  }
  if ((fm.description || '').length > 1024) warnings.push('description longer than 1024 chars');
  if (!isSafeId(id)) warnings.push('unsafe skill name — refused for file use (no summary stamps)');
  if (fm.name && fm.name !== dirName) warnings.push('name differs from folder (' + dirName + ') — allowed in pi, not in the strict spec');
  const tools = TOOL_VOCAB.filter(t => toolUsed(t, body));
  const desc = fm.description || '';
  const triggers = [...(desc + ' ' + body.slice(0, 4000)).matchAll(/["“]([^"”]{6,70})["”]/g)]
    .map(m => m[1].trim())
    .filter(s => !s.includes('\n') && /^[a-z]/i.test(s))
    .slice(0, 12);

  const rec = {
    id,
    title: id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: desc,
    origin, originLabel, pkg,
    ...prov,
    tierLabel: TIER_LABEL[prov.tier],
    path: rel,
    raw,
    allPaths: [rel],
    headings,
    sections,
    warnings,
    frontmatter: fm,
    invoke: '/skill:' + id,
    hidden: String(fm['disable-model-invocation'] || '') === 'true',
    allowedTools: fm['allowed-tools'] || '',
    tools,
    triggers: [...new Set(triggers)],
    bytes: raw.length,
    lines: raw.split('\n').length,
    body,
  };

  if (!candidates.has(id)) candidates.set(id, []);
  candidates.get(id).push({ rec, rank: rootIdx < 0 ? ROOTS.length : rootIdx, real: realOf(fp) });
}

// ---- dedupe: which copy represents the skill ----
// 1. the copy pi loads in the PRIMARY project;  2. else the copy loaded in the most
// configured projects;  3. else earliest scan root (installed before dashboard source);
// 4. else code-point path order. Never "longest body". Adding, removing or reordering
// non-primary projects can only change the shown copy via rule 2, for skills the primary
// project does not load.
const byId = new Map();
for (const [id, list] of candidates) {
  const pp = primary && primary.real.get(id);
  const votes = c => projects.filter(p => p.real.get(id) === c.real).length;
  list.sort((a, b) => (pp ? (b.real === pp) - (a.real === pp) : 0) || votes(b) - votes(a) ||
    a.rank - b.rank || (a.rec.path < b.rec.path ? -1 : a.rec.path > b.rec.path ? 1 : 0));
  const win = list[0].rec, winReal = list[0].real;
  win.allPaths = list.map(c => c.rec.path);
  win.loaded = !!pp && winReal === pp;                    // loaded in the primary project
  // per project: does pi load this skill there, and is it the shown text?
  win.loadedIn = projects.filter(p => p.real.has(id)).map(p => {
    const f = p.real.get(id), c = list.find(x => x.real === f);
    return { project: p.label, path: c ? c.rec.path : f.replace(HOME, '~'), same: !!c && c.rec.raw === win.raw };
  });
  // copies whose text differs from the shown one — the atlas describes only the shown text
  win.divergentPaths = list.slice(1).filter(c => c.rec.raw !== win.raw).map(c => c.rec.path);
  if (pp && winReal !== pp) win.warnings.push('pi loads a copy that could not be read: ' + pp);
  byId.set(id, win);
}

// sort BEFORE deriving links, so link order and group iteration are stable
const skills = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (const s of skills) s.category = categorize(s.id, s.description, s.body, s.pkg);

// ---- relationships ----
const ids = skills.map(s => s.id);
const links = [];
const seen = new Set();
function addLink(a, b, type, weight, why) {
  if (a === b) return;
  const key = [a, b].sort().join('|') + '|' + type;
  if (seen.has(key)) return;
  seen.add(key);
  links.push({ source: a, target: b, type, weight, why });
}

// 1. explicit cross-reference: skill A's body names skill B.
//    Single-word ids ('browser', 'doctor', 'autofix') are ordinary English and matched
//    everything, so they need an unambiguous skill-shaped mention. Hyphenated ids are
//    distinctive enough on their own.
for (const s of skills) {
  const hay = s.body;
  for (const other of ids) {
    if (other === s.id || other.length < 4) continue;
    const q = other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = other.includes('-')
      ? new RegExp('(^|[^A-Za-z0-9_-])' + q + '([^A-Za-z0-9_-]|$)').test(hay)
      // NOT a bare `backtick` match: CLI command lists like `doctor`, `archive`, `status`
      // collide with single-word skill ids and produced dozens of phantom edges.
      : new RegExp('(/skill:' + q + '\\b|\\bskill:\\s*' + q + '\\b|\\b' + q + ' skill\\b)', 'i').test(hay);
    if (hit) addLink(s.id, other, 'references', 3, s.id + ' names ' + other + ' in its SKILL.md');
  }
}
// 2. same package / bundle
const pkgGroups = {};
for (const s of skills) (pkgGroups[s.pkg] ||= []).push(s.id);
for (const [pkg, members] of Object.entries(pkgGroups)) {
  if (members.length < 2 || members.length > 14) continue;
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++)
      addLink(members[i], members[j], 'bundle', 1.4, 'shipped together in ' + pkg);
}
// 3. shared distinctive tools
const toolGroups = {};
for (const s of skills) for (const t of s.tools) (toolGroups[t] ||= []).push(s.id);
for (const [tool, members] of Object.entries(toolGroups)) {
  if (members.length < 2 || members.length > 6) continue; // only distinctive tools
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++)
      addLink(members[i], members[j], 'shares-tool', 0.9, 'both drive ' + tool + '()');
}

// degree
const deg = {};
for (const l of links) { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; }
for (const s of skills) s.degree = deg[s.id] || 0;

// "related" = only real cross-references, the one link type worth reading in prose form
for (const s of skills) {
  s.related = links
    .filter(l => l.type === 'references' && (l.source === s.id || l.target === s.id))
    .map(l => (l.source === s.id ? l.target : l.source));
  s.related = [...new Set(s.related)].sort();
}

// keep the verbatim SKILL.md (`raw`) for the catalog's "original prompt" fold;
// drop the derived body/sections that only the old force-graph needed
for (const s of skills) {
  const wtu = s.body.match(/^##\s*When to Use[\s\S]*?(?=\n##\s|\n#\s|$)/im);
  s.whenToUse = wtu ? wtu[0].replace(/^##\s*When to Use\s*/i, '').trim().slice(0, 700) : '';
  delete s.body;
  delete s.sections;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // code-point order, never locale-dependent
links.sort((a, b) => cmp(a.type, b.type) || cmp(a.source, b.source) || cmp(a.target, b.target));

// fingerprint of every input byte that shaped the scan (path + content of each SKILL.md
// that won dedupe, plus its alternate paths). Stands in for a timestamp.
const fingerprint = sha(skills.map(s => s.path + '\n' + s.allPaths.join('|') + '\n' + (s.loaded ? 'L' : '-') + '\n' +
  JSON.stringify(s.loadedIn) + '\n' + s.raw).join('\u0000')).slice(0, 16);

const payload = {
  fingerprint,
  resolver: { kind: resolved.resolver,
              cwd: primary && primary.cwd ? primary.cwd.replace(HOME, '~') : null,
              loaded: skills.filter(s => s.loaded).length,
              projects: projects.map(p => ({ label: p.label, cwd: p.cwd ? p.cwd.replace(HOME, '~') : null, primary: !!p.primary,
                                             skills: skills.filter(s => s.loadedIn.some(l => l.project === p.label)).length })) },
  counts: {
    skills: skills.length,
    links: links.length,
    byOrigin: skills.reduce((a, s) => (a[s.originLabel] = (a[s.originLabel] || 0) + 1, a), {}),
    byCategory: skills.reduce((a, s) => (a[s.category] = (a[s.category] || 0) + 1, a), {}),
    byTier: skills.reduce((a, s) => (a[s.tierLabel] = (a[s.tierLabel] || 0) + 1, a), {}),
  },
  skills, links,
};
return payload;
}
