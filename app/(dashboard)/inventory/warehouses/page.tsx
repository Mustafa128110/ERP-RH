import { listLocations } from "@/lib/actions/locations";
import { LocationManager } from "@/components/modules/LocationManager";

export default async function WarehousesPage() {
  const locationRows = await listLocations();
  return <LocationManager locations={locationRows} />;
}
