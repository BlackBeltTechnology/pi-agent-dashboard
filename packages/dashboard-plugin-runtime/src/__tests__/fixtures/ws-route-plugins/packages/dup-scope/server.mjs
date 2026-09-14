// E1 plugin "B": duplicate scope name — must throw.
export default async (ctx) => {
  ctx.registerWsRoute("browser-ext", {
    pathPrefix: "/ws/dup/",
    admitOrigins: [],
    handleUpgrade: () => {},
  });
};
