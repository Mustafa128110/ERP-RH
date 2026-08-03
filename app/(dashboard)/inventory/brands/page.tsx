import { listBrands } from "@/lib/actions/brands";
import { BrandManager } from "@/components/modules/BrandManager";

export default async function BrandsPage() {
  const brandRows = await listBrands();
  return <BrandManager brands={brandRows} />;
}
