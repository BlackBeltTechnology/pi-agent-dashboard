# preview-path-link.ts — index

Bridge half of the reserve-path pair (D9): `createPreviewPathLink` sends `preview_path_request`, validates `/preview/<22>/` answers, releases an aborted/late reservation once (`preview_path_release`); `installBaseReservationListener` answers the neutral `mock-site:base-reservation` probe (first listener sets `probe.pending` synchronously). The server decides; the bridge forwards.
