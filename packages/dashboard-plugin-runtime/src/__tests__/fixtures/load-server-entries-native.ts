// Child-process fixture: run `loadServerEntries` under the server's real
// loader (spawned with `--import native-ts-register.mjs`) against the repo
// root given in argv[2], and print the plugin status as JSON.
import { getPluginStatusStore, loadServerEntries } from "../../server/loader.js";

const repoRoot = process.argv[2] as string;
await loadServerEntries({
  createContext: () => ({}) as never,
  isEnabled: () => true,
  repoRoot,
});
console.log(JSON.stringify(getPluginStatusStore().getStatus("hash-dir-plugin") ?? null));
