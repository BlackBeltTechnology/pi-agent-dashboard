/**
 * Test index for the affected-test selector: every test file vitest collects
 * (root config AND the real-process config), the local modules each reaches,
 * the locations each names by string literal, and whether it is gated on
 * RUN_CI_SCENARIOS. See change: speed-up-ci-affected-tests (D1, D2).
 *
 * Reuses vitest's own project resolution and each project's SSR transform, so
 * aliases, workspace `exports → src/` and per-project plugins resolve exactly
 * as they do when the tests run. Only the walk is re-implemented — with
 * try/catch PER MODULE: a module that fails to transform (e.g. monaco-setup.ts,
 * whose `monaco-editor` has no resolvable entry) becomes a recorded leaf and
 * never drops its importer's other edges. Stock `vitest --changed` aborts the
 * whole walk on the first such error.
 */
import fs from "node:fs";
import path from "node:path";

import { extractLocations, isGatedSource } from "./decide.mjs";

export const REAL_PROCESS_CONFIG = "packages/server/vitest.real-process.config.ts";

/** Computed (non-literal) SSR dynamic import → the module is an open edge. */
const DYNAMIC_IMPORT_RE = /__vite_ssr_dynamic_import__\(\s*([^\s)])/g;

export function hasOpenDynamicImport(code) {
  for (const m of code.matchAll(DYNAMIC_IMPORT_RE)) {
    const quote = m[1];
    if (quote === '"' || quote === "'") continue;
    if (quote === "`") {
      // A template literal is only literal without an interpolation.
      const rest = code.slice(m.index + m[0].length - 1);
      const end = rest.indexOf("`", 1);
      if (end > 0 && !rest.slice(0, end).includes("${")) continue;
    }
    return true;
  }
  return false;
}

const toPosix = (p) => p.split(path.sep).join("/");

function topLevelEntries(root) {
  const skip = new Set([".git", "node_modules", ".worktrees"]);
  return fs.readdirSync(root).filter((n) => !skip.has(n));
}

/** Repo-relative POSIX path of a local (in-repo, non-node_modules) file, else null. */
function makeRel(realRoot) {
  const rel = (abs) => {
    let p = abs;
    try {
      p = fs.realpathSync(abs);
    } catch {
      /* keep as given */
    }
    const r = toPosix(path.relative(realRoot, p));
    return r.startsWith("..") || path.isAbsolute(r) ? null : r;
  };
  const local = (abs) => {
    const r = rel(abs);
    return r !== null && !r.split("/").includes("node_modules") ? r : null;
  };
  return { rel, local };
}

/** Every setupFiles / globalSetup entry any project declares, repo-relative. */
async function collectGlobalInputs(vitest, local, out) {
  for (const project of vitest.projects) {
    for (const key of ["setupFiles", "globalSetup"]) {
      const val = project.config[key];
      for (const entry of Array.isArray(val) ? val : val ? [val] : []) {
        let abs = path.isAbsolute(entry) ? entry : null;
        if (!abs) {
          const importer = path.join(project.config.root, "index.ts");
          abs = (await project.vite.environments.ssr.pluginContainer.resolveId(entry, importer))?.id ?? null;
        }
        const r = abs ? local(abs) : null;
        if (r) out.add(r);
      }
    }
  }
}

/** Absolute local paths of a transform result's static + dynamic deps. */
function localDeps(tr, projectRoot, local) {
  const out = [];
  for (const d of [...(tr.deps ?? []), ...(tr.dynamicDeps ?? [])]) {
    const clean = d.split("?")[0];
    const candidates = [clean.startsWith("/@fs/") ? clean.slice(4) : path.join(projectRoot, clean), clean];
    const hit = candidates.find((c) => path.isAbsolute(c) && fs.existsSync(c) && local(c));
    if (hit) out.push(fs.realpathSync(hit));
  }
  return out;
}

/**
 * Memoised per-project module → deps function. A module that fails to
 * transform is recorded in `leafErrors` and yields no deps (a leaf).
 */
function moduleDepsFor(project, { rel, local, leafErrors, openModules }) {
  const env = project.vite.environments.ssr;
  const cache = new Map();
  const load = async (abs) => {
    let tr;
    try {
      tr = env.moduleGraph.getModuleById(abs)?.transformResult ?? (await env.transformRequest(abs));
    } catch (e) {
      leafErrors.set(rel(abs) ?? abs, String(e?.message ?? e).split("\n")[0].slice(0, 160));
      return [];
    }
    if (!tr) return [];
    if (tr.code && hasOpenDynamicImport(tr.code)) openModules.add(rel(abs));
    return localDeps(tr, project.config.root, local);
  };
  return (abs) => {
    if (!cache.has(abs)) cache.set(abs, load(abs));
    return cache.get(abs);
  };
}

/** Every local module a test file reaches, repo-relative, sorted (the file itself excluded). */
async function reachable(spec, moduleDeps, rel) {
  const seen = new Set();
  const visit = async (abs) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    await Promise.all((await moduleDeps(abs)).map(visit));
  };
  const self = fs.realpathSync(spec.moduleId);
  await visit(self);
  seen.delete(self);
  return [...seen].map(rel).filter(Boolean).sort();
}

/**
 * @param {{ root: string, withGraph?: boolean, concurrency?: number }} opts
 *   withGraph=false enumerates tests (+ literal/gated scan) without walking imports.
 */
export async function buildTestIndex({ root, withGraph = true, concurrency = 16 }) {
  const t0 = Date.now();
  const { createVitest } = await import("vitest/node");
  const { rel, local } = makeRel(fs.realpathSync(root));
  const configs = [{ phase: "parallel", options: {} }];
  if (fs.existsSync(path.join(root, REAL_PROCESS_CONFIG))) {
    configs.push({ phase: "real-process", options: { config: path.join(root, REAL_PROCESS_CONFIG) } });
  }
  const topLevel = topLevelEntries(root);
  const state = { rel, local, leafErrors: new Map(), openModules: new Set() };
  const tests = {};
  const globalInputs = new Set();

  for (const { phase, options } of configs) {
    const vitest = await createVitest("test", { watch: false, run: false, reporters: [], root, ...options });
    try {
      const specs = await vitest.globTestSpecifications();
      await collectGlobalInputs(vitest, local, globalInputs);
      const perProject = new Map();
      const depsFn = (project) => {
        if (!perProject.has(project)) perProject.set(project, moduleDepsFor(project, state));
        return perProject.get(project);
      };
      const queue = [...specs];
      const worker = async () => {
        for (let spec = queue.shift(); spec; spec = queue.shift()) {
          const file = rel(spec.moduleId);
          if (!file) continue;
          const source = fs.readFileSync(spec.moduleId, "utf8");
          tests[file] = {
            deps: withGraph ? await reachable(spec, depsFn(spec.project), rel) : [],
            phase,
            locations: extractLocations(source, topLevel),
            gated: isGatedSource(source),
          };
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      await vitest.close();
    }
  }

  const sortedTests = {};
  for (const k of Object.keys(tests).sort()) sortedTests[k] = tests[k];
  return {
    tests: sortedTests,
    openModules: [...state.openModules].filter(Boolean).sort(),
    globalInputs: [...globalInputs].sort(),
    leafErrors: [...state.leafErrors].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    ms: Date.now() - t0,
  };
}
