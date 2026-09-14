// E1 second table: registers a DEEP prefix first (loads before "shallow").
export default async (ctx) => {
  ctx.registerWsRoute("deep", {
    pathPrefix: "/ws/deep/inner/",
    admitOrigins: [],
    handleUpgrade: () => {},
  });
};
