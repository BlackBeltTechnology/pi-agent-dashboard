import { useMobile } from "../../../../../../client-utils/src/useMobile";

export const Bad = () => (useMobile() ? "m" : "d");
