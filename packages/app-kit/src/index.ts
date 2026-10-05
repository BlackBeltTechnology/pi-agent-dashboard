// `@blackbelt-technology/pi-dashboard-app-kit` — the framework-free half:
// endpoint config, identity state, transport, login descriptor, socket.
// Imports neither React nor `react-oidc-context` (see `./react`).
export {
  type AppConfig,
  AppKitError,
  apiUrl,
  configureDashboard,
  dashboardOrigin,
  isDashboardOrigin,
  type LoadAppConfigOptions,
  loadAppConfig,
  resetAppConfig,
  wsUrl,
} from "./config.js";
export {
  currentOperator,
  getAccessToken,
  getIdentityMode,
  type IdentityMode,
  notifySessionRefused,
  type Operator,
  onIdentityChange,
  onSessionRefused,
  resetIdentityState,
  setAccessToken,
  setActingOperator,
  setCredential,
  setIdentityMode,
} from "./identity-state.js";
export {
  type FetchLoginDescriptorOptions,
  fetchLoginDescriptor,
  initIdentity,
  type LoginDescriptor,
  type LoginDescriptorResult,
} from "./login-descriptor.js";
export {
  connectWithReconnect,
  type MinimalSocket,
  type ReconnectHandle,
  type ReconnectOptions,
  type ReconnectStatus,
} from "./socket.js";
export {
  appendWsTicket,
  authedFetch,
  authorizeTestSockets,
  mintWsTicket,
  NoCredentialError,
  NotAdmittedError,
  setTicketMinterForTests,
  ticketSocketUrl,
} from "./transport.js";
