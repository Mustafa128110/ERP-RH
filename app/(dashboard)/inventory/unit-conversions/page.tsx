import { listUnitConversions, getUnitConversion } from "@/lib/actions/unit-conversions";
import { getCompanies, getItemOptions, getUnits } from "@/lib/queries/lookups";
import { UnitConversionManager } from "@/components/modules/UnitConversionManager";

export default async function UnitConversionsPage() {
  const [conversions, itemRows, unitRows, companyRows] = await Promise.all([
    listUnitConversions(),
    getItemOptions(),
    getUnits(),
    getCompanies(),
  ]);

  return (
    <UnitConversionManager
      conversions={conversions}
      getDetail={getUnitConversion}
      itemOptions={itemRows}
      unitOptions={unitRows}
      companyOptions={companyRows}
    />
  );
}
