/** Harness barrel: injected clock, fake host ctx, faux `pi --mode rpc` driver. */
export { FakeClock } from "./fake-clock.js";
export { createFakeHostCtx, loadConfigDefaults } from "./fake-host-ctx.js";
export { FauxPiProcess, fauxPiAvailable } from "./faux-pi-rpc.js";
