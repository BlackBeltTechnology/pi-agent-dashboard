# plugin-intent-cache.ts — index

Server-side cache of most recent plugin intent per `(pluginId, sessionId, slot)`. Replays current state to reconnecting clients on subscribe. Exports `PluginIntentCache` class (`set`/`getForSession`/`getAll`/`clearForSession`/`reset`), `pluginIntentCache` singleton, `CachedIntentEntry`. `set(intent=null)` removes entry. See change: adopt-server-driven-intent-rendering.
