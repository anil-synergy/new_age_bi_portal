export default function AccessDeniedPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <h1 className="text-2xl font-bold">Access Denied</h1>
      <p className="mt-2 text-slate-600">You do not have access to this report or page.</p>
      <a href="/dashboard" className="mt-4 text-primary underline">Go to dashboard</a>
    </div>
  );
}
