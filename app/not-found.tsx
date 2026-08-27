import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-ivory p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-sand bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brass-600">404</p>
        <h1 className="text-xl text-navy-800">This page is not available</h1>
        <p className="text-sm text-steel">It may have moved, been removed, or you may not have access to it.</p>
        <Link href="/dashboard" className="flex h-12 items-center justify-center rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700">Back to dashboard</Link>
      </div>
    </main>
  );
}
