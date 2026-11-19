export default function UnauthorizedPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <h1 className="text-2xl font-bold">Unauthorized</h1>
      <p className="mt-2 text-slate-600">You do not have permission to access this resource.</p>
      <a href="/login" className="mt-4 text-primary underline">Return to login</a>
    </div>
  );
}
