/**
 * Entry of the Services settings pages. `services` renders the list, or the
 * detail when the URL carries an id (`/settings/services/<id>`); an unknown id
 * renders the list with a not-found notice. `runtimes` renders the runtime
 * report. Instant-apply: these pages register no Save Bar draft.
 * See change: add-services-settings-ui.
 */
import type { UseServices } from "../../../hooks/useServices.js";
import { RuntimesPage } from "./RuntimesPage.js";
import { ServiceDetailPage } from "./ServiceDetailPage.js";
import { ServicesListPage } from "./ServicesListPage.js";

export function ServicesPages({
  page,
  serviceId,
  services,
  navigate,
}: {
  page: "services" | "runtimes";
  serviceId: string | null;
  services: UseServices;
  navigate: (to: string) => void;
}) {
  if (page === "runtimes") return <RuntimesPage />;
  if (serviceId) {
    const known = !services.list || services.list.services.some((s) => s.id === serviceId);
    if (known) return <ServiceDetailPage id={serviceId} services={services} navigate={navigate} />;
    return <ServicesListPage services={services} navigate={navigate} notFoundId={serviceId} />;
  }
  return <ServicesListPage services={services} navigate={navigate} />;
}
