// Spike: cost of ISOLATED per-child loaders (fresh Extension[] + runtime) with a warm parent.
// Strategies:
//   full     : new DefaultResourceLoader({cwd}).reload()                            (what the tool does today)
//   lean     : same, but noSkills/noPromptTemplates/noThemes
//   wrapper  : thin ResourceLoader delegating everything to the parent loader EXCEPT
//              getExtensions(), which is re-instantiated per child from the cached jiti
//              factories via the *private* loadExtensionsCached (proves the floor).
import { createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "/Users/robson/.nvm/versions/node/v25.8.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { loadExtensionsCached } from "/Users/robson/.nvm/versions/node/v25.8.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const cwd = process.argv[2] ?? "/Users/robson/Project/judo-ng";
const strategy = process.argv[3] ?? "full";
const n = Number(process.argv[4] ?? 7);
// Optional 5th arg: an alternate agent dir (its settings.json decides WHICH
// checkout's extensions/resolver are loaded), so the npm-root memo can be
// A/B-measured without touching the user's real ~/.pi/agent.
// See change: heal-orphaned-tool-cards-on-session-end (task 4b.8).
const agentDirArg = process.argv[5];

// warm parent
const parent = new DefaultResourceLoader({ cwd, agentDir: (agentDirArg ?? getAgentDir()) }); await parent.reload();
const parentPaths = parent.getExtensions().extensions.map(e => e.path);

let maxLag = 0, last = Date.now();
const lagTimer = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 20); last = now; }, 20);

async function childLoader() {
  if (strategy === "full") { const l = new DefaultResourceLoader({ cwd, agentDir: (agentDirArg ?? getAgentDir()) }); await l.reload(); return l; }
  if (strategy === "lean") { const l = new DefaultResourceLoader({ cwd, agentDir: (agentDirArg ?? getAgentDir()), noSkills: true, noPromptTemplates: true, noThemes: true }); await l.reload(); return l; }
  if (strategy === "wrapper") {
    const ext = await loadExtensionsCached(parentPaths, cwd, parent.eventBus);
    return new Proxy(parent, { get(t, k) { return k === "getExtensions" ? () => ext : Reflect.get(t, k); } });
  }
  throw new Error(strategy);
}

const t0 = performance.now(); last = Date.now(); maxLag = 0;
const per = [];
const sessions = await Promise.all(Array.from({ length: n }, async () => {
  const a = performance.now();
  const loader = await childLoader();
  const b = performance.now();
  const { session } = await createAgentSession({ cwd, sessionManager: SessionManager.inMemory(cwd), resourceLoader: loader });
  per.push({ loaderMs: Math.round(b - a), sessionMs: Math.round(performance.now() - b) });
  return session;
}));
const wall = Math.round(performance.now() - t0);
clearInterval(lagTimer);
const distinctRuntime = new Set(sessions.map(s => s._resourceLoader.getExtensions().runtime)).size;
const tools = sessions[0].getActiveToolNames().length;
for (const s of sessions) s.dispose();
console.log(JSON.stringify({ strategy, n, wallMs: wall, maxLoopLagMs: maxLag, rssMB: Math.round(process.memoryUsage().rss / 1e6), distinctRuntime, toolsPerChild: tools, perChild: per }));
