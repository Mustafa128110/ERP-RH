import Link from "next/link";
import { notFound } from "next/navigation";
import { getSale } from "@/lib/actions/sales";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { SaleFormPage } from "@/components/modules/SaleForm";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [sale, options] = await Promise.all([getSale(id), getSaleFormOptions(id)]);

  if (!sale) notFound();

  return (
    <div className="flex h-full flex-col gap-2">
      <Link href="/sales/invoices" className="text-sm text-steel hover:text-navy-800">
        ← Invoices
      </Link>
      {/* Title and Delete are the form's own heading row — the page used to draw
          a second one above it, which is the gap this removes. */}
      <SaleFormPage title="Edit Sale" saleId={sale.id} defaults={sale} {...options} />
    </div>
  );
}
