// E1 plugin "C": prefix nested under A's — must throw.
export default async (ctx) => {
  ctx.registerWsRoute("nested-ext", {
    pathPrefix: "/ws/browser-ext/x/",
    admitOrigins: [],
    handleUpgrade: () => {},
  });
};
