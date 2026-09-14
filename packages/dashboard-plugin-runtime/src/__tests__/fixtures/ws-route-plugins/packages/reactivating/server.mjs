// E3: registers on every activation; stashes the ctx so the test can attempt
// a LATE registration after the activation window closes.
export default async (ctx) => {
  globalThis.__extCtx = ctx;
  globalThis.__activations = (globalThis.__activations ?? 0) + 1;
  ctx.registerWsRoute("ext", {
    pathPrefix: "/ws/ext/",
    admitOrigins: [],
    handleUpgrade: () => {
      globalThis.__handlerGeneration = globalThis.__activations;
    },
  });
};
