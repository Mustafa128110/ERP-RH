import { listUnits } from "@/lib/actions/units";
import { UnitManager } from "@/components/modules/UnitManager";

export default async function UnitsPage() {
  const units = await listUnits();
  return <UnitManager units={units} />;
}
