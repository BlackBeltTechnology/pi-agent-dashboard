/**
 * Host-owned cross-plugin service registry backing `ctx.provide` / `consume` /
 * `consumeAll`. Records the PROVIDER plugin id per key and enforces
 * `automation.action.<source>` key ownership: the provider id MUST equal
 * `<source>` (first segment after the prefix), so one plugin cannot spoof or
 * overwrite another plugin's action contributions. Host-set entries
 * (`set`) are exempt and carry provider `host`. Values never cross the bridge.
 * See change: harden-git-terminal-plugin-boundaries (D16).
 */

/** Namespace whose keys are owned by the plugin named in the key. */
export const AUTOMATION_ACTION_KEY_PREFIX = "automation.action.";

/** Provider id recorded for host-set entries. */
export const HOST_PROVIDER = "host";

export interface ServiceEntry<T = unknown> {
  key: string;
  value: T;
  provider: string;
}

/**
 * `<source>` of an `automation.action.<source>[.…]` key: the first segment
 * after the prefix. `null` when the key is outside the namespace; `""` when
 * the source is empty (malformed).
 */
export function automationActionSource(key: string): string | null {
  if (!key.startsWith(AUTOMATION_ACTION_KEY_PREFIX)) return null;
  const rest = key.slice(AUTOMATION_ACTION_KEY_PREFIX.length);
  const dot = rest.indexOf(".");
  return dot === -1 ? rest : rest.slice(0, dot);
}

export interface PluginServiceRegistry {
  /** Plugin `provide`: store `value` under `name`, attributed to `provider`. Refused (logged, returns) on a key-ownership violation. */
  provide(provider: string, name: string, value: unknown): void;
  /** Host-set entry (provider `host`); exempt from key ownership. */
  set(name: string, value: unknown): void;
  get<T = unknown>(name: string): T | undefined;
  /** Every entry whose key starts with `prefix`, with its recorded provider. Entries are fresh copies (no aliasing of the registry). */
  entries<T = unknown>(prefix: string): Array<ServiceEntry<T>>;
}

export function createPluginServiceRegistry(opts?: { warn?: (msg: string) => void }): PluginServiceRegistry {
  const warn = opts?.warn ?? ((m: string) => console.warn(m));
  const store = new Map<string, { value: unknown; provider: string }>();
  return {
    provide(provider, name, value) {
      const source = automationActionSource(name);
      if (source !== null) {
        if (source === "") {
          warn(`[plugin-service] refused provide("${name}") by plugin "${provider}": empty source segment (malformed key)`);
          return;
        }
        if (source !== provider) {
          warn(
            `[plugin-service] refused provide("${name}") by plugin "${provider}": ` +
              `the provider of an ${AUTOMATION_ACTION_KEY_PREFIX}<source> key must be "${source}"`,
          );
          return;
        }
      }
      store.set(name, { value, provider });
    },
    set(name, value) {
      store.set(name, { value, provider: HOST_PROVIDER });
    },
    get<T = unknown>(name: string) {
      return store.get(name)?.value as T | undefined;
    },
    entries<T = unknown>(prefix: string) {
      const out: Array<ServiceEntry<T>> = [];
      for (const [key, e] of store) {
        if (key.startsWith(prefix)) out.push({ key, value: e.value as T, provider: e.provider });
      }
      return out;
    },
  };
}
