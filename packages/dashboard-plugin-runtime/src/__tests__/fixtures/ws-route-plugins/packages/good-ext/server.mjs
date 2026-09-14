// E1 plugin "A": the registration that must SURVIVE the failed ones.
export default async (ctx) => {
  ctx.registerWsRoute("browser-ext", {
    pathPrefix: "/ws/browser-ext/",
    admitOrigins: ["chrome-extension://abc"],
    handleUpgrade: () => {},
  });
};
