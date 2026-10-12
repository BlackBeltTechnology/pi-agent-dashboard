// Ask pi itself which SKILL.md it loads for each skill name — per project, because pi's
// "first discovered wins" depends on the cwd (project .pi/skills, project settings packages,
// .agents/skills ancestors). Uses the public SDK (DefaultResourceLoader) with extensions,
// prompts, themes and context files disabled, so nothing third-party executes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PKG = '@earendil-works/pi-coding-agent';
const HOME = os.homedir();
export const expandHome = p => String(p).replace(/^~(?=\/|$)/, HOME);
export const tildify = p => (p ? String(p).replace(HOME, '~') : p);

function findPiPackage(explicit) {
  const tries = [];
  if (explicit) tries.push(expandHome(explicit));
  if (process.env.PI_PACKAGE_DIR) tries.push(process.env.PI_PACKAGE_DIR);
  try {
    // the `pi` binary is a symlink into the package; walk up to its package.json
    let d = path.dirname(fs.realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()));
    for (let i = 0; i < 6; i++, d = path.dirname(d)) tries.push(d);
  } catch { /* no pi on PATH */ }
  tries.push('/opt/homebrew/lib/node_modules/' + PKG, '/usr/local/lib/node_modules/' + PKG);
  for (const d of tries) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
      if (j.name === PKG) return { dir: d, version: j.version };
    } catch { /* keep looking */ }
  }
  return null;
}

/* Resolve every project. `projects` = [{ cwd, label? }]; the first is the PRIMARY project.
   -> { resolver: 'pi-sdk@x' | 'none', note,
        projects: [{ cwd, label, primary, ok, note, loaded: { name: absPath } }] }          */
export async function resolveProjects(projects, { piPackageDir } = {}) {
  const list = projects.map((p, i) => {
    const cwd = path.resolve(expandHome(p.cwd));
    return { cwd, label: p.label || path.basename(cwd), primary: i === 0, ok: false, note: '', loaded: {} };
  });
  const pkg = findPiPackage(piPackageDir);
  if (!pkg) return { resolver: 'none', note: 'pi package not found — falling back to scan-root order', projects: list };
  let mod;
  try { mod = await import(pathToFileURL(path.join(pkg.dir, 'dist', 'index.js')).href); }
  catch (e) { return { resolver: 'none', note: 'pi SDK import failed: ' + String(e.message || e).slice(0, 120), projects: list }; }
  for (const p of list) {
    if (!fs.existsSync(p.cwd)) { p.note = 'directory does not exist'; continue; }
    try {
      const loader = new mod.DefaultResourceLoader({
        cwd: p.cwd, agentDir: mod.getAgentDir(),
        noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      });
      await loader.reload();
      for (const s of loader.getSkills().skills) p.loaded[s.name] = s.filePath;
      p.ok = true;
    } catch (e) { p.note = 'resolver failed: ' + String(e.message || e).slice(0, 120); }
  }
  const ok = list.some(p => p.ok);
  return { resolver: ok ? 'pi-sdk@' + pkg.version : 'none', note: ok ? '' : 'no project could be resolved', projects: list };
}

// Back-compat single-project helper (used by selftest's resolver smoke check).
export async function piLoaded(cwd, opts) {
  const r = await resolveProjects([{ cwd }], opts);
  const p = r.projects[0];
  return { resolver: p.ok ? r.resolver : 'none', cwd: p.cwd, loaded: p.loaded, note: p.note || r.note };
}

/* Candidate projects for the config: dashboard pinned folders + ~/projects/* with a .pi dir.
   Read-only; prints nothing secret (only directory paths). */
export function suggestProjects() {
  const out = new Map();
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(HOME, '.pi/dashboard/preferences.json'), 'utf8'));
    for (const d of prefs.pinnedDirectories || []) if (fs.existsSync(d)) out.set(path.resolve(d), 'dashboard pinned');
  } catch { /* no dashboard prefs */ }
  try {
    for (const e of fs.readdirSync(path.join(HOME, 'projects'), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const d = path.join(HOME, 'projects', e.name);
      if (e.isDirectory() && fs.existsSync(path.join(d, '.pi')) && !out.has(d)) out.set(d, 'has .pi/');
    }
  } catch { /* no ~/projects */ }
  return [...out].map(([cwd, why]) => ({ cwd, why }));
}
