# browse-api.ts — index

Client-side browse API helper for PathPicker. See change: distinguish-offline-from-network-denied — exports NetworkNotAllowedError (code "network_not_allowed", hint, reason); browseDirectory uses fetchJsonResponse, throws NetworkNotAllowedError on 403 network_not_allowed.
