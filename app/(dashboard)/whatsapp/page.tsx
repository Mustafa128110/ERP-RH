import { PageHeader } from "@/components/ui/PageHeader";

export default async function Page() {
  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="WhatsApp" subtitle="Messaging" />
      <div className="rounded-lg border border-sand bg-white p-6">
        <h2 className="text-sm font-semibold text-navy-800">WhatsApp messaging is not available</h2>
        <p className="mt-1 text-sm text-steel">
          This tab is kept for the future. WhatsApp sending, the assistant, and the message log have been removed
          from the app.
        </p>
      </div>
    </div>
  );
}
