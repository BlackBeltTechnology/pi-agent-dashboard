# Pi Dashboard Roles Plugin

Built-in Pi Dashboard plugin providing the model-role settings UI.

Claims the `settings-section` slot on the General tab, so third-party plugins can
replace or augment it through the same slot system.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## For plugin authors: `roles.bindings`

When this plugin is installed it provides the in-process server service
`roles.bindings` (v1). A plugin whose config file is owned by a third-party
program can let users bind its model fields to a role:

```ts
// in your server entry — look the service up in onReady (load order is irrelevant)
ctx.fastify.addHook("onReady", async () => {
  const roles = ctx.consume<RolesBindings>("roles.bindings"); // undefined → feature off
  roles?.registerProjector({
    owner: "my-plugin",
    acceptsField: (f) => f === "primaryModel",          // allow-list of bindable fields
    read: (f) => /* current { provider, id, level? } or undefined */,
    write: (f, resolved) => /* persist the concrete model; throw {code:"PROJECTION_CONFLICT"} if the file changed under you */,
  });
});
```

Your save route resolves the role (`roles.resolve("@fast")`), writes the concrete value once
inside `roles.withOwnerLock(owner, …)`, then records it with `roles.replaceBindings(owner, …)`.
The engine re-projects on every role/preset change and sets status `ok` / `dangling` /
`detached`. Resolve-at-use plugins (value read by your own server) just store `@role`, call
`resolveModelRef` from `@blackbelt-technology/pi-dashboard-shared/role-schema.js` at use time, and
optionally `registerUsage(owner, () => [{ label, ref }])` to appear in the "Used by" list.
See `docs/architecture.md` § *Role-aware model refs & projection*.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
