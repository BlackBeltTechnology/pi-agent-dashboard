/** Harness barrel: injected clock, fake host ctx, faux `pi --mode rpc` driver, store env. */
export { FakeClock } from "./fake-clock.js";
export { createFakeHostCtx, loadConfigDefaults } from "./fake-host-ctx.js";
export { createFakeRuntimeHost, type FakeRuntimeHost } from "./fake-runtime-host.js";
export { FauxPiProcess, fauxPiAvailable } from "./faux-pi-rpc.js";
export { capturingLogger, createStoreEnv, memberFixture, type StoreEnv, tmpDataDir } from "./store-env.js";
