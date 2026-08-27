export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-1 items-center justify-center bg-zinc-50 px-4 py-[max(1rem,env(safe-area-inset-top))] dark:bg-zinc-950">
      {children}
    </div>
  );
}
