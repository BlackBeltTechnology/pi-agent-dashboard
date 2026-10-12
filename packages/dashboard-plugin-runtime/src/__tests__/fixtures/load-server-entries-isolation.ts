// Child-process fixture: run `loadServerEntries` under the server's real
// loader (`--import native-ts-register.mjs`) against the repo root in argv[2]
// and print the status of every plugin id in argv[3..] as a JSON map.
import { getPluginStatusStore, loadServerEntries } from "../../server/loader.js";

const [repoRoot, ...ids] = process.argv.slice(2) as [string, ...string[]];
await loadServerEntries({
  createContext: () => ({}) as never,
  isEnabled: () => true,
  repoRoot,
});
const store = getPluginStatusStore();
console.log(JSON.stringify(Object.fromEntries(ids.map((id) => [id, store.getStatus(id) ?? null]))));
