import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";

export const Bad = () => (useMobile() ? "m" : "d");
