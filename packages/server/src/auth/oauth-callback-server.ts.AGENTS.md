# oauth-callback-server.ts — index

Temporary HTTP callback server for OAuth auth-code flows. Exports `CallbackServerOptions`, `CallbackServerHandle`, `startCallbackServer`, `closeAllCallbackServers`. Listens on 127.0.0.1, serves success/error HTML, auto-closes on code receipt or 5min timeout, tracks active servers per `providerId`, destroys sockets on close.
