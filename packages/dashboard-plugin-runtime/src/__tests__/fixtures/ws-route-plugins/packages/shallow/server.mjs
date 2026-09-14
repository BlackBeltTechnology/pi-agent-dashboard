// E1 second table: a NEW prefix that would swallow the existing deep one.
export default async (ctx) => {
  ctx.registerWsRoute("shallow", {
    pathPrefix: "/ws/deep/",
    admitOrigins: [],
    handleUpgrade: () => {},
  });
};
